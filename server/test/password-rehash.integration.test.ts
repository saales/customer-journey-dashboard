import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { hashPassword, verifyPassword } from "../src/password-hashing.js";
import { authenticatePostgresCredentials } from "../src/postgres-authentication.js";
import { createHttpTestEnvironment, integrationDatabaseUrl, type HttpTestEnvironment } from "./helpers/http-test-environment.js";

/**
 * Aggiornamento dei parametri scrypt al login, su schema reale e con il ruolo runtime non privilegiato:
 * un hash storico (p=1) viene sostituito da uno nuovo (p=3) senza cambiare la password,
 * e un cambio password concorrente non viene mai sovrascritto.
 */
const LEGACY_PASSWORD = "Correct-Horse-Battery-42!";
const LEGACY_HASH = "scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$-LMJe_5NYS2FVj5wZhiiYAojo_D4THFEEWlZDG8wvPv-ub--CBRx_cNhUCm_jDnR8t2IiXFvVxQE2ufYOJSxmA";
const CURRENT = /^scrypt\$32768\$8\$3\$/;

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
let seq = 0;

async function legacyUser() {
  const email = `legacy-${++seq}@example.test`;
  const user = await env.adminPool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, full_name, status, email_verified_at) VALUES ($1,$2,'Legacy','active',NOW()) RETURNING id::text AS id", [email, LEGACY_HASH]);
  await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'viewer')", [env.tenants.A.id, user.rows[0]!.id]);
  return { id: user.rows[0]!.id, email };
}
const stored = async (id: string) => (await env.adminPool.query<{ password_hash: string; updated_at: Date }>("SELECT password_hash, updated_at FROM users WHERE id=$1", [id])).rows[0]!;

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });
const login = (email: string, password: string) =>
  env.request("POST", "/api/auth/login", { body: { email, password, organizationSlug: "tenant-a" } });

describe.skipIf(!dbUrl)("Aggiornamento dell'hash password al login (schema reale)", () => {
  beforeAll(async () => { await env.adminPool.query("DELETE FROM login_attempt_limits"); });

  it("un hash storico p=1 viene portato a p=3 al primo login riuscito, con il ruolo runtime, e la password resta valida", async () => {
    const user = await legacyUser();
    expect((await stored(user.id)).password_hash).toBe(LEGACY_HASH);
    const response = await login(user.email, LEGACY_PASSWORD);
    expect(response.status).toBe(200);
    const after = await stored(user.id);
    expect(after.password_hash).toMatch(CURRENT);
    expect(await verifyPassword(LEGACY_PASSWORD, after.password_hash)).toBe(true);
    expect((await login(user.email, LEGACY_PASSWORD)).status).toBe(200);
  });

  it("i login successivi non riscrivono l'hash già aggiornato (updated_at invariato)", async () => {
    const user = await legacyUser();
    await login(user.email, LEGACY_PASSWORD);
    const first = await stored(user.id);
    await login(user.email, LEGACY_PASSWORD);
    const second = await stored(user.id);
    expect(second.password_hash).toBe(first.password_hash);
    expect(second.updated_at.getTime()).toBe(first.updated_at.getTime());
  });

  it("un tentativo con password errata non modifica l'hash storico", async () => {
    const user = await legacyUser();
    expect((await login(user.email, "Password-sbagliata-123")).status).toBe(401);
    expect((await stored(user.id)).password_hash).toBe(LEGACY_HASH);
  });

  it("utente sospeso: nessun login e nessun aggiornamento dell'hash", async () => {
    const user = await legacyUser();
    await env.adminPool.query("UPDATE users SET status='disabled' WHERE id=$1", [user.id]);
    expect((await login(user.email, LEGACY_PASSWORD)).status).toBe(401);
    expect((await stored(user.id)).password_hash).toBe(LEGACY_HASH);
  });

  it("un cambio password concorrente NON viene sovrascritto: il vecchio login fallisce e vale la nuova password", async () => {
    const user = await legacyUser();
    const newPassword = "Nuova-password-concorrente-2026!";
    const newHash = await hashPassword(newPassword);
    let fired = false;
    const racing = {
      connect: async () => {
        const client = await env.runtimePool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
          const result = await original(...args);
          // subito dopo la lettura delle credenziali, un altro processo cambia la password
          if (!fired && typeof args[0] === "string" && /FROM users u/.test(args[0])) {
            fired = true;
            await env.adminPool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [newHash, user.id]);
          }
          return result;
        };
        return client as PoolClient;
      },
    } as Pick<Pool, "connect">;
    const issued = await authenticatePostgresCredentials(racing as Pool, user.email, LEGACY_PASSWORD, "tenant-a");
    expect(fired).toBe(true);
    expect(issued).toBeNull(); // la vecchia password non è più valida
    expect((await stored(user.id)).password_hash).toBe(newHash); // e la nuova non è stata cancellata
    expect((await login(user.email, newPassword)).status).toBe(200);
  });

  it("la latenza del login con i parametri attuali resta sotto 1,5 secondi (misura locale, non del server di produzione)", async () => {
    const user = await legacyUser();
    await login(user.email, LEGACY_PASSWORD); // aggiornamento incluso
    const t0 = performance.now();
    const response = await login(user.email, LEGACY_PASSWORD);
    const ms = performance.now() - t0;
    expect(response.status).toBe(200);
    expect(ms).toBeLessThan(1500);
  });
});
