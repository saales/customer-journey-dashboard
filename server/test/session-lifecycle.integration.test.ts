import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPasswordReset } from "../src/postgres-password-reset.js";
import {
  createHttpTestEnvironment, integrationDatabaseUrl, TEST_PASSWORD, ORIGIN,
  type ApiResponse, type HttpTestEnvironment, type Role, type TenantKey,
} from "./helpers/http-test-environment.js";

/**
 * Ciclo di vita delle sessioni su PostgreSQL reale e con il server HTTP reale:
 * emissione, scadenza assoluta (12 h), inattività (30 min), revoca, cambio e
 * recupero password, sospensione di utenti/membri/organizzazioni, rate limit
 * di login e hardening del trasporto del token (solo cookie HttpOnly).
 *
 * Il tempo viene "spostato" riscrivendo expires_at/last_used_at con il ruolo
 * proprietario del test: non si usano timer finti, quindi si prova la query reale.
 */

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
let userSeq = 0;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function cookieTokenFrom(response: ApiResponse): string {
  const raw = response.headers.getSetCookie().find((c) => c.startsWith("percorso_session="));
  expect(raw, "Set-Cookie di sessione mancante").toBeTruthy();
  return raw!.split(";")[0]!.slice("percorso_session=".length);
}

/** Crea un utente dedicato (password nota) così i test distruttivi non toccano gli utenti condivisi. */
async function makeUser(tenant: TenantKey, role: Role = "viewer", email?: string) {
  const address = email ?? `sess-${++userSeq}-${randomUUID().slice(0, 8)}@example.test`;
  const org = env.tenants[tenant].id;
  const user = await env.adminPool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, full_name, status, email_verified_at) SELECT $1, password_hash, 'Utente sessione', 'active', NOW() FROM users WHERE email='admin.a@example.test' RETURNING id::text AS id",
    [address]);
  const membership = await env.adminPool.query<{ id: string }>(
    "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,$3) RETURNING id::text AS id", [org, user.rows[0]!.id, role]);
  return { id: user.rows[0]!.id, email: address, membershipId: membership.rows[0]!.id, org };
}

async function login(email: string, password = TEST_PASSWORD, slug = "tenant-a") {
  return env.request("POST", "/api/auth/login", { body: { email, password, organizationSlug: slug } });
}

const ok = (token: string) => env.request("GET", "/api/account", { token });
const sessionRow = async (token: string) =>
  (await env.adminPool.query("SELECT id::text AS id, user_id::text AS user_id, expires_at, last_used_at FROM sessions WHERE token_hash=$1", [sha256(token)])).rows[0];

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });
// Tutti i login arrivano da 127.0.0.1: si azzerano i bucket per non far dipendere i test dall'ordine.
beforeEach(async () => { if (dbUrl) await env.adminPool.query("DELETE FROM login_attempt_limits"); });

describe.skipIf(!dbUrl)("Sessioni — emissione e archiviazione", () => {
  it("il login emette un cookie HttpOnly, SameSite=Strict, valido ~12 ore, e salva solo l'hash del token", async () => {
    const user = await makeUser("A");
    const response = await login(user.email);
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("percorso_session="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/); // ambiente non-produzione; in produzione è Secure (vedi test dedicato)
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)![1]);
    expect(maxAge).toBeGreaterThan(12 * 3600 - 60);
    expect(maxAge).toBeLessThanOrEqual(12 * 3600);
    const token = cookieTokenFrom(response);
    expect(response.text).not.toContain(token); // il token non compare nel corpo della risposta
    const row = await env.adminPool.query("SELECT token_hash FROM sessions WHERE user_id=$1", [user.id]);
    expect(row.rows).toEqual([{ token_hash: sha256(token) }]);
    const leak = await env.adminPool.query("SELECT 1 FROM sessions WHERE token_hash=$1", [token]);
    expect(leak.rowCount).toBe(0); // il valore in chiaro non è mai persistito
    expect((await ok(token)).status).toBe(200);
  });

  it("la scadenza assoluta è impostata a ~12 ore dall'emissione", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    const row = await env.adminPool.query<{ hours: number }>(
      "SELECT EXTRACT(EPOCH FROM (expires_at - created_at))/3600 AS hours FROM sessions WHERE token_hash=$1", [sha256(token)]);
    expect(Number(row.rows[0]!.hours)).toBeCloseTo(12, 1);
  });

  it("il ruolo runtime non può prolungare una sessione via SQL: solo last_used_at è aggiornabile", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    await expect(env.runtimePool.query("UPDATE sessions SET expires_at = NOW() + INTERVAL '10 years' WHERE token_hash=$1", [sha256(token)]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(env.runtimePool.query("UPDATE sessions SET user_id = $2 WHERE token_hash=$1", [sha256(token), env.tenants.A.users.admin.id]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("in produzione il cookie usa il prefisso __Host- ed è Secure", async () => {
    const { serializePostgresSessionCookie } = await import("../src/postgres-auth-routes.js");
    const cookie = serializePostgresSessionCookie("A".repeat(43), new Date(Date.now() + 3_600_000).toISOString(), true);
    expect(cookie).toMatch(/^__Host-percorso_session=/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });
});

describe.skipIf(!dbUrl)("Sessioni — scadenza assoluta e inattività", () => {
  it("una sessione oltre expires_at viene rifiutata (401) su tutte le API protette", async () => {
    const user = await makeUser("A", "admin");
    const token = cookieTokenFrom(await login(user.email));
    expect((await ok(token)).status).toBe(200);
    await env.adminPool.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash=$1", [sha256(token)]);
    for (const path of ["/api/account", "/api/auth/session", "/api/customers", "/api/members", "/api/export/organization.json"]) {
      const response = await env.request("GET", path, { token });
      expect(response.status, path).toBe(401);
    }
  });

  it("una sessione inattiva da oltre 30 minuti è rifiutata e NON viene riattivata da nuove richieste", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    await env.adminPool.query("UPDATE sessions SET last_used_at = NOW() - INTERVAL '31 minutes' WHERE token_hash=$1", [sha256(token)]);
    expect((await ok(token)).status).toBe(401);
    expect((await ok(token)).status).toBe(401); // la richiesta rifiutata non ha aggiornato last_used_at
    const row = await sessionRow(token);
    expect(Date.now() - new Date(row.last_used_at).getTime()).toBeGreaterThan(30 * 60_000);
  });

  it("una sessione inattiva da 29 minuti è ancora valida e l'attività sposta in avanti il timeout (sliding)", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    await env.adminPool.query("UPDATE sessions SET last_used_at = NOW() - INTERVAL '29 minutes' WHERE token_hash=$1", [sha256(token)]);
    expect((await ok(token)).status).toBe(200);
    const row = await sessionRow(token);
    expect(Date.now() - new Date(row.last_used_at).getTime()).toBeLessThan(10_000);
    // Subito dopo, un altro intervallo di 29 minuti è di nuovo tollerato: il timeout è scorrevole.
    await env.adminPool.query("UPDATE sessions SET last_used_at = NOW() - INTERVAL '29 minutes' WHERE token_hash=$1", [sha256(token)]);
    expect((await ok(token)).status).toBe(200);
  });

  it("l'attività non supera mai la scadenza assoluta, anche se la sessione è sempre attiva", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    await env.adminPool.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute', last_used_at = NOW() WHERE token_hash=$1", [sha256(token)]);
    expect((await ok(token)).status).toBe(401);
  });

  it("l'elenco sessioni mostra solo quelle attive, marca quella corrente e omette scadute/inattive", async () => {
    const user = await makeUser("A");
    const current = cookieTokenFrom(await login(user.email));
    const expired = cookieTokenFrom(await login(user.email));
    const idle = cookieTokenFrom(await login(user.email));
    const other = cookieTokenFrom(await login(user.email));
    await env.adminPool.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash=$1", [sha256(expired)]);
    await env.adminPool.query("UPDATE sessions SET last_used_at = NOW() - INTERVAL '45 minutes' WHERE token_hash=$1", [sha256(idle)]);
    const list = await env.request<{ sessions: Array<{ id: string; current: boolean }> }>("GET", "/api/account/sessions", { token: current });
    expect(list.status).toBe(200);
    const ids = list.body.sessions.map((s) => s.id);
    expect(ids).toContain((await sessionRow(current)).id);
    expect(ids).toContain((await sessionRow(other)).id);
    expect(ids).not.toContain((await sessionRow(expired)).id);
    expect(ids).not.toContain((await sessionRow(idle)).id);
    expect(list.body.sessions.filter((s) => s.current)).toEqual([expect.objectContaining({ id: (await sessionRow(current)).id })]);
    expect(list.text).not.toContain(current); // nessun token nell'elenco
  });
});

describe.skipIf(!dbUrl)("Sessioni — revoca", () => {
  it("il logout elimina la sessione, cancella il cookie e il token non è più utilizzabile", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    const response = await env.request("POST", "/api/auth/logout", { token });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().find((c) => c.startsWith("percorso_session="))).toMatch(/Max-Age=0/);
    expect(await sessionRow(token)).toBeUndefined();
    expect((await ok(token)).status).toBe(401);
    expect((await env.request("POST", "/api/auth/logout", { token })).status).toBe(401); // idempotenza: nessun errore interno
  });

  it("il logout richiede un Origin autorizzato (CSRF): senza o con Origin estraneo → 403 e la sessione resta valida", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    expect((await env.request("POST", "/api/auth/logout", { token, origin: null })).status).toBe(403);
    expect((await env.request("POST", "/api/auth/logout", { token, origin: "https://attacker.example" })).status).toBe(403);
    expect((await ok(token)).status).toBe(200);
  });

  it("revocare un'altra propria sessione la invalida subito senza toccare quella corrente", async () => {
    const user = await makeUser("A");
    const current = cookieTokenFrom(await login(user.email));
    const other = cookieTokenFrom(await login(user.email));
    const otherId = (await sessionRow(other)).id;
    const response = await env.request("DELETE", `/api/account/sessions/${otherId}`, { token: current });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().find((c) => c.startsWith("percorso_session="))).toBeUndefined(); // il cookie corrente resta
    expect((await ok(other)).status).toBe(401);
    expect((await ok(current)).status).toBe(200);
  });

  it("revocare la sessione corrente per ID cancella anche il cookie", async () => {
    const user = await makeUser("A");
    const current = cookieTokenFrom(await login(user.email));
    const response = await env.request("DELETE", `/api/account/sessions/${(await sessionRow(current)).id}`, { token: current });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().find((c) => c.startsWith("percorso_session="))).toMatch(/Max-Age=0/);
    expect((await ok(current)).status).toBe(401);
  });

  it("non si può revocare la sessione di un altro utente dello stesso tenant (404) e quella resta valida", async () => {
    const attacker = await makeUser("A", "admin");
    const victim = await makeUser("A");
    const attackerToken = cookieTokenFrom(await login(attacker.email));
    const victimToken = cookieTokenFrom(await login(victim.email));
    const response = await env.request("DELETE", `/api/account/sessions/${(await sessionRow(victimToken)).id}`, { token: attackerToken });
    expect(response.status).toBe(404);
    expect((await ok(victimToken)).status).toBe(200);
  });

  it("revocare una sessione scrive una voce di audit senza includere il token", async () => {
    const user = await makeUser("A", "admin");
    const current = cookieTokenFrom(await login(user.email));
    const other = cookieTokenFrom(await login(user.email));
    const otherId = (await sessionRow(other)).id;
    await env.request("DELETE", `/api/account/sessions/${otherId}`, { token: current });
    const audit = await env.adminPool.query("SELECT details::text AS details, resource_id FROM audit_logs WHERE action='account.session_revoked' AND actor_user_id=$1", [user.id]);
    expect(audit.rows).toEqual([{ details: "{}", resource_id: otherId }]);
  });

  it("sessioni indipendenti: più login dello stesso utente coesistono e si revocano singolarmente", async () => {
    const user = await makeUser("A");
    const tokens = [] as string[];
    for (let i = 0; i < 3; i += 1) tokens.push(cookieTokenFrom(await login(user.email)));
    expect(new Set(tokens).size).toBe(3);
    await env.request("POST", "/api/auth/logout", { token: tokens[1] });
    expect((await ok(tokens[0]!)).status).toBe(200);
    expect((await ok(tokens[1]!)).status).toBe(401);
    expect((await ok(tokens[2]!)).status).toBe(200);
  });
});

describe.skipIf(!dbUrl)("Sessioni — cambio e recupero password", () => {
  it("password errata nel cambio → 401 e tutte le sessioni restano valide", async () => {
    const user = await makeUser("A");
    const a = cookieTokenFrom(await login(user.email));
    const b = cookieTokenFrom(await login(user.email));
    const response = await env.request("POST", "/api/account/password", { token: a, body: { currentPassword: "Password-errata-123", newPassword: "Nuova-password-2026!" } });
    expect(response.status).toBe(401);
    expect((await ok(a)).status).toBe(200);
    expect((await ok(b)).status).toBe(200);
  });

  it("il cambio password revoca TUTTE le sessioni dell'utente (anche altri dispositivi e altri tenant) e vale solo la nuova password", async () => {
    const user = await makeUser("A", "analyst");
    await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'viewer')", [env.tenants.B.id, user.id]);
    const a1 = cookieTokenFrom(await login(user.email));
    const a2 = cookieTokenFrom(await login(user.email));
    const b1 = cookieTokenFrom(await login(user.email, TEST_PASSWORD, "tenant-b"));
    const response = await env.request("POST", "/api/account/password", { token: a1, body: { currentPassword: TEST_PASSWORD, newPassword: "Nuova-password-2026!" } });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().find((c) => c.startsWith("percorso_session="))).toMatch(/Max-Age=0/);
    for (const token of [a1, a2, b1]) expect((await ok(token)).status).toBe(401);
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(401);
    expect((await login(user.email, "Nuova-password-2026!")).status).toBe(200);
    const audit = await env.adminPool.query("SELECT 1 FROM audit_logs WHERE action='account.password_changed' AND actor_user_id=$1", [user.id]);
    expect(audit.rowCount).toBe(1);
  });

  it("il recupero password: token monouso, revoca di tutte le sessioni, vecchia password invalidata", async () => {
    const user = await makeUser("A");
    const session = cookieTokenFrom(await login(user.email));
    const reset = await createPostgresPasswordReset(env.runtimePool, user.email, "tenant-a");
    expect(reset).not.toBeNull();
    const stored = await env.adminPool.query("SELECT token_hash FROM password_reset_tokens WHERE user_id=$1", [user.id]);
    expect(stored.rows).toEqual([{ token_hash: sha256(reset!.token) }]); // solo hash a database
    const done = await env.request("POST", "/api/auth/password-reset/complete", { body: { token: reset!.token, password: "Reimpostata-2026!" } });
    expect(done.status).toBe(200);
    expect(done.headers.getSetCookie().find((c) => c.startsWith("percorso_session="))).toMatch(/Max-Age=0/);
    expect((await ok(session)).status).toBe(401);
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(401);
    expect((await login(user.email, "Reimpostata-2026!")).status).toBe(200);
    const reuse = await env.request("POST", "/api/auth/password-reset/complete", { body: { token: reset!.token, password: "Altra-password-2026!" } });
    expect(reuse.status).toBe(400); // monouso
    expect((await login(user.email, "Reimpostata-2026!")).status).toBe(200);
  });

  it("un token di recupero scaduto è rifiutato e la password non cambia", async () => {
    const user = await makeUser("A");
    const reset = await createPostgresPasswordReset(env.runtimePool, user.email, "tenant-a");
    await env.adminPool.query("UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id=$1", [user.id]);
    const done = await env.request("POST", "/api/auth/password-reset/complete", { body: { token: reset!.token, password: "Scaduta-2026-password!" } });
    expect(done.status).toBe(400);
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("richiedere il recupero per un tenant sbagliato non produce token e la risposta è identica", async () => {
    const user = await makeUser("A");
    const known = await env.request("POST", "/api/auth/password-reset/request", { body: { email: user.email, organizationSlug: "tenant-a" } });
    const wrongTenant = await env.request("POST", "/api/auth/password-reset/request", { body: { email: user.email, organizationSlug: "tenant-b" } });
    const unknown = await env.request("POST", "/api/auth/password-reset/request", { body: { email: "nessuno@example.test", organizationSlug: "tenant-a" } });
    expect([known.status, wrongTenant.status, unknown.status]).toEqual([202, 202, 202]);
    expect(wrongTenant.body).toEqual(known.body);
    expect(unknown.body).toEqual(known.body);
    expect(await createPostgresPasswordReset(env.runtimePool, user.email, "tenant-b")).toBeNull();
  });
});

describe.skipIf(!dbUrl)("Sessioni — sospensioni e disattivazioni effetto immediato", () => {
  it("la sospensione della membership invalida subito la sessione esistente", async () => {
    const user = await makeUser("A", "editor");
    const token = cookieTokenFrom(await login(user.email));
    expect((await ok(token)).status).toBe(200);
    await env.adminPool.query("UPDATE memberships SET status='suspended' WHERE id=$1", [user.membershipId]);
    expect((await ok(token)).status).toBe(401);
    expect((await env.request("GET", "/api/customers", { token })).status).toBe(401);
    expect((await login(user.email)).status).toBe(401);
  });

  it("la disattivazione dell'utente invalida subito tutte le sue sessioni e blocca il login", async () => {
    const user = await makeUser("A");
    const token = cookieTokenFrom(await login(user.email));
    await env.adminPool.query("UPDATE users SET status='disabled' WHERE id=$1", [user.id]);
    expect((await ok(token)).status).toBe(401);
    expect((await login(user.email)).status).toBe(401);
  });

  it("la sospensione dell'organizzazione invalida le sessioni del suo tenant ma non quelle dell'altro", async () => {
    const orgUser = await makeUser("A");
    const token = cookieTokenFrom(await login(orgUser.email));
    const otherTenantToken = env.tenants.B.users.viewer.token;
    await env.adminPool.query("UPDATE organizations SET status='suspended' WHERE id=$1", [env.tenants.A.id]);
    try {
      expect((await ok(token)).status).toBe(401);
      expect((await env.request("GET", "/api/account", { token: env.tenants.A.users.admin.token })).status).toBe(401);
      expect((await login(orgUser.email)).status).toBe(401);
      expect((await ok(otherTenantToken)).status).toBe(200);
    } finally {
      await env.adminPool.query("UPDATE organizations SET status='active' WHERE id=$1", [env.tenants.A.id]);
    }
  });

  it("l'eliminazione di un tenant elimina a cascata le sue sessioni (nessuna sessione orfana valida)", async () => {
    const org = await env.adminPool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Effimero','effimero') RETURNING id::text AS id");
    const user = await env.adminPool.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, full_name) VALUES ('effimero@example.test','x','E') RETURNING id::text AS id");
    await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'admin')", [org.rows[0]!.id, user.rows[0]!.id]);
    const token = await env.newSession(user.rows[0]!.id, org.rows[0]!.id);
    expect((await ok(token)).status).toBe(200);
    await env.adminPool.query("DELETE FROM organizations WHERE id=$1", [org.rows[0]!.id]);
    expect((await ok(token)).status).toBe(401);
    expect(await sessionRow(token)).toBeUndefined();
  });
});

describe.skipIf(!dbUrl)("Sessioni — login: nessuna enumerazione e limitazione dei tentativi", () => {
  it("tutti i fallimenti di login producono la stessa risposta (401 'Credenziali non valide.')", async () => {
    const suspended = await makeUser("A");
    await env.adminPool.query("UPDATE memberships SET status='suspended' WHERE id=$1", [suspended.membershipId]);
    const disabled = await makeUser("A");
    await env.adminPool.query("UPDATE users SET status='disabled' WHERE id=$1", [disabled.id]);
    const active = await makeUser("A");
    const cases = [
      await login("inesistente@example.test"),
      await login(active.email, "Password-sbagliata-123"),
      await login(active.email, TEST_PASSWORD, "tenant-b"), // organizzazione di cui non è membro
      await login(active.email, TEST_PASSWORD, "organizzazione-inesistente"),
      await login(suspended.email),
      await login(disabled.email),
    ];
    for (const response of cases) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Credenziali non valide." });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("dopo 10 tentativi falliti la stessa identità riceve 429 con Retry-After, anche con la password giusta; le altre identità no", async () => {
    const victim = await makeUser("A");
    const bystander = await makeUser("A");
    for (let i = 0; i < 10; i += 1) expect((await login(victim.email, `Sbagliata-${i}-password`)).status).toBe(401);
    const blocked = await login(victim.email, TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    expect(blocked.headers.getSetCookie()).toEqual([]);
    expect((await login(bystander.email)).status).toBe(200);
  });

  it("un login riuscito azzera il contatore dell'identità", async () => {
    const user = await makeUser("A");
    for (let i = 0; i < 5; i += 1) await login(user.email, `Sbagliata-${i}-password`);
    expect((await login(user.email)).status).toBe(200);
    for (let i = 0; i < 9; i += 1) await login(user.email, `Sbagliata-${i}-password`);
    expect((await login(user.email)).status).toBe(200); // se il contatore non fosse stato azzerato sarebbe 429
  }, 20_000);

  it("il login richiede un Origin autorizzato", async () => {
    const user = await makeUser("A");
    const response = await env.request("POST", "/api/auth/login", {
      origin: "https://attacker.example", body: { email: user.email, password: TEST_PASSWORD, organizationSlug: "tenant-a" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await env.request("POST", "/api/auth/login", { origin: null, body: { email: user.email, password: TEST_PASSWORD, organizationSlug: "tenant-a" } })).status).toBe(403);
  });
});

describe.skipIf(!dbUrl)("Sessioni — il token viaggia solo nel cookie HttpOnly", () => {
  it("token in query string, header Authorization, body o header personalizzati NON autenticano", async () => {
    const token = env.tenants.A.users.admin.token;
    expect((await env.request("GET", `/api/account?token=${token}&session=${token}`)).status).toBe(401);
    expect((await env.request("GET", "/api/account", { headers: { Authorization: `Bearer ${token}`, "X-Session-Token": token, "X-Api-Key": token } })).status).toBe(401);
    expect((await env.request("POST", "/api/customers", { body: { token, channel: "Email" } })).status).toBe(401);
  });

  it("cookie ambigui o malformati sono rifiutati: duplicati, nome sbagliato, spazi, lunghezza errata", async () => {
    const token = env.tenants.A.users.admin.token;
    const cases = [
      `percorso_session=${token}; percorso_session=${token}`,
      `__Host-percorso_session=${token}`,
      `percorso_session=${token}x`,
      `percorso_session=${token.slice(0, 42)}`,
      `percorso_session=${token}%00`,
      `Percorso_Session=${token}`,
    ];
    for (const rawCookie of cases) expect((await env.request("GET", "/api/account", { rawCookie })).status, rawCookie).toBe(401);
    expect((await env.request("GET", "/api/account", { rawCookie: `other=1; percorso_session=${token}` })).status).toBe(200);
  });

  it("le risposte autenticate non sono memorizzabili in cache e variano per cookie", async () => {
    const response = await env.request("GET", "/api/account", { token: env.tenants.A.users.admin.token });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toMatch(/Cookie/i);
  });

  it("il corpo di una sessione non rivela dati sensibili", async () => {
    const response = await env.request("GET", "/api/auth/session", { token: env.tenants.A.users.admin.token });
    expect(Object.keys(response.body as object).sort()).toEqual(["organizationId", "role", "userId"]);
    expect(response.text).not.toMatch(/password|hash|token/i);
    expect(ORIGIN).toMatch(/^https:/);
  });
});
