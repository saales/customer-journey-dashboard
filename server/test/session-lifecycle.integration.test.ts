import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpTestEnvironment, integrationDatabaseUrl, TEST_PASSWORD, type HttpTestEnvironment } from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function makeUser() {
  const email = `session-${randomUUID()}@example.test`;
  const org = env.tenants.A.id;
  const inserted = await env.adminPool.query<{ id: string }>(
    "INSERT INTO users (email,password_hash,full_name,status,email_verified_at) SELECT $1,password_hash,'Session test','active',NOW() FROM users WHERE email='admin.a@example.test' RETURNING id::text AS id",
    [email],
  );
  const userId = inserted.rows[0]!.id;
  await env.adminPool.query("INSERT INTO memberships (organization_id,user_id,role,status) VALUES ($1,$2,'admin','active')", [org,userId]);
  return { email, userId, org };
}
async function login(email: string) {
  return env.request("POST", "/api/auth/login", { body: { email, password: TEST_PASSWORD, organizationSlug: "tenant-a" } });
}
function tokenFrom(response: Response | { headers: Headers }) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("percorso_session="));
  expect(cookie).toBeTruthy();
  return cookie!.split(";")[0]!.slice("percorso_session=".length);
}
const hash = (token: string) => sha256(token);
const account = (token: string) => env.request("GET", "/api/account", { token });
async function sessionRow(token: string) {
  return (await env.adminPool.query<{ id: string; last_used_at: Date; expires_at: Date }>(
    "SELECT id::text AS id,last_used_at,expires_at FROM sessions WHERE token_hash=$1", [hash(token)],
  )).rows[0];
}

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
beforeEach(async () => { if (dbUrl) await env.adminPool.query("DELETE FROM login_attempt_limits"); });
afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Ciclo di vita HTTP delle sessioni", () => {
  it("il login emette un cookie HttpOnly e persiste solo l'hash del token", async () => {
    const user = await makeUser();
    const response = await login(user.email);
    expect(response.status).toBe(200);
    const token = response.headers.getSetCookie().find((value) => value.startsWith("percorso_session="))!.split(";")[0]!.slice("percorso_session=".length);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("percorso_session="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(response.text).not.toContain(token);
    const rows = await env.adminPool.query("SELECT token_hash FROM sessions WHERE user_id=$1", [user.userId]);
    expect(rows.rows).toEqual([{ token_hash: hash(token) }]);
    expect((await account(token)).status).toBe(200);
  });

  it("rifiuta sessioni scadute assolutamente o inattive oltre 30 minuti", async () => {
    const user = await makeUser();
    const absolute = tokenFrom(await login(user.email));
    expect((await account(absolute)).status).toBe(200);
    await env.adminPool.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1", [hash(absolute)]);
    expect((await account(absolute)).status).toBe(401);

    const idle = tokenFrom(await login(user.email));
    await env.adminPool.query("UPDATE sessions SET last_used_at=NOW()-INTERVAL '31 minutes' WHERE token_hash=$1", [hash(idle)]);
    expect((await account(idle)).status).toBe(401);
    expect((await account(idle)).status).toBe(401);
  });

  it("logout invalida il token e cancella il cookie; un Origin estraneo non può revocarlo", async () => {
    const user = await makeUser();
    const token = tokenFrom(await login(user.email));
    expect((await env.request("POST", "/api/auth/logout", { token, origin: "https://attacker.example" })).status).toBe(403);
    expect((await account(token)).status).toBe(200);
    const response = await env.request("POST", "/api/auth/logout", { token });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().find((value) => value.startsWith("percorso_session="))).toMatch(/Max-Age=0/i);
    expect((await account(token)).status).toBe(401);
  });

  it("revoca una sessione selezionata senza invalidare le altre sessioni dello stesso utente", async () => {
    const user = await makeUser();
    const current = tokenFrom(await login(user.email));
    const other = tokenFrom(await login(user.email));
    const otherId = (await sessionRow(other))!.id;
    const response = await env.request("DELETE", `/api/account/sessions/${otherId}`, { token: current });
    expect(response.status).toBe(204);
    expect((await account(other)).status).toBe(401);
    expect((await account(current)).status).toBe(200);
    expect(response.headers.getSetCookie().find((value) => value.startsWith("percorso_session="))).toBeUndefined();
  });
});
