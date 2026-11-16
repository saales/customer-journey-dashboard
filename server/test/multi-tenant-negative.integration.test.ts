import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHttpTestEnvironment, integrationDatabaseUrl, TEST_PASSWORD,
  type HttpTestEnvironment, type TenantKey,
} from "./helpers/http-test-environment.js";

/**
 * Test negativi cross-tenant su PostgreSQL reale con ruolo runtime non privilegiato.
 *
 * Attore: utenti del tenant A. Vittima: tenant B. Ogni attacco verifica tre cose:
 *   1) la risposta HTTP non concede né rivela nulla del tenant B;
 *   2) lo stato del tenant B nel database è IDENTICO prima e dopo (snapshot);
 *   3) dove rilevante, anche il database stesso (RLS) rifiuta l'accesso.
 */

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
let bInviteId: string;
let bInviteToken: string;
let bCustomStage: string;
let bReferralCustomerId: string;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Fotografia completa e ordinata di tutto ciò che appartiene a un tenant. */
async function snapshotTenant(key: TenantKey) {
  const org = env.tenants[key].id;
  const q = async (sql: string) => (await env.adminPool.query(sql, [org])).rows;
  return {
    organization: await q("SELECT id, name, slug, status FROM organizations WHERE id=$1"),
    customers: await q("SELECT id, external_id, channel, created_at FROM customers WHERE organization_id=$1 ORDER BY id"),
    events: await q("SELECT id, customer_id, stage_id, occurred_at FROM events WHERE organization_id=$1 ORDER BY id"),
    stages: await q("SELECT id, label, position, is_active FROM funnel_stages WHERE organization_id=$1 ORDER BY id"),
    memberships: await q("SELECT id, user_id, role, status FROM memberships WHERE organization_id=$1 ORDER BY id"),
    invitations: await q("SELECT id, email, role, accepted_at, revoked_at, expires_at FROM invitations WHERE organization_id=$1 ORDER BY id"),
    imports: await q("SELECT id, fingerprint, customer_count FROM import_batches WHERE organization_id=$1 ORDER BY id"),
    audit: await q("SELECT id, action, resource_id FROM audit_logs WHERE organization_id=$1 ORDER BY id"),
  };
}

const A = () => env.tenants.A;
const B = () => env.tenants.B;
const importRow = (externalId: string, over: Record<string, unknown> = {}) => ({
  externalId, channel: "Email", createdAt: "2026-04-01", stage: "visit", occurredAt: "2026-04-01", ...over,
});

beforeAll(async () => {
  if (!dbUrl) return;
  env = await createHttpTestEnvironment();
  const b = B();
  // Dati aggiuntivi riconoscibili del tenant B: fase personalizzata, cliente "Referral", invito pendente.
  bCustomStage = "custom_tenantb_only";
  await env.adminPool.query(
    "INSERT INTO funnel_stages (organization_id, id, label, position, is_active, is_system) VALUES ($1,$2,'Solo B',10,TRUE,FALSE)",
    [b.id, bCustomStage],
  );
  const referral = await env.adminPool.query<{ id: string }>(
    "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'b-referral-secret','Referral','2026-02-01') RETURNING id::text AS id",
    [b.id],
  );
  bReferralCustomerId = referral.rows[0]!.id;
  await env.adminPool.query(
    "INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit','2026-02-01'), ($1,$2::bigint,$3,'2026-02-03')",
    [b.id, bReferralCustomerId, bCustomStage],
  );
  bInviteToken = randomBytes(32).toString("base64url");
  const invite = await env.adminPool.query<{ id: string }>(
    `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1,'invitato-b@example.test','analyst',$2,$3, NOW() + INTERVAL '7 days') RETURNING id::text AS id`,
    [b.id, sha256(bInviteToken), b.users.admin.id],
  );
  bInviteId = invite.rows[0]!.id;
}, 60_000);

afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Multi-tenant — EVENTI e CLIENTI: il tenant A non tocca il tenant B", () => {
  it("PUT su un cliente del tenant B (ID noto) → 404 e il tenant B resta identico", async () => {
    const before = await snapshotTenant("B");
    const response = await env.request("PUT", `/api/customers/${B().customerIds[0]}`, {
      token: A().users.admin.token,
      body: { externalId: "hijacked", channel: "Referral", createdAt: "2026-01-10", events: [{ stage: "lead", occurredAt: "2026-01-11" }] },
    });
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toMatch(/tenant|b-referral|only-b/i);
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("DELETE su un cliente del tenant B → 404; cliente ed eventi (cascade) restano", async () => {
    const before = await snapshotTenant("B");
    for (const id of [...B().customerIds, bReferralCustomerId]) {
      const response = await env.request("DELETE", `/api/customers/${id}`, { token: A().users.admin.token });
      expect(response.status).toBe(404);
    }
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("un evento del tenant A non può usare una fase che esiste solo nel tenant B", async () => {
    const beforeA = await snapshotTenant("A");
    const beforeB = await snapshotTenant("B");
    const response = await env.request("PUT", `/api/customers/${A().customerIds[0]}`, {
      token: A().users.admin.token,
      body: { externalId: "shared-ext-1", channel: "Email", createdAt: "2026-01-10", events: [{ stage: bCustomStage, occurredAt: "2026-01-11" }] },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await snapshotTenant("A")).toEqual(beforeA);
    expect(await snapshotTenant("B")).toEqual(beforeB);
  });

  it("l'elenco clienti del tenant A non contiene nessun cliente, evento o identificativo del tenant B", async () => {
    const response = await env.request<{ data: Array<{ id: string; events: unknown[] }>; pagination: { total: number } }>(
      "GET", "/api/customers?limit=100", { token: A().users.viewer.token });
    expect(response.status).toBe(200);
    const ids = response.body.data.map((customer) => customer.id).sort();
    expect(ids).toEqual([...A().customerIds].sort());
    expect(response.body.pagination.total).toBe(A().customerIds.length);
    expect(response.text).not.toContain("b-referral-secret");
    expect(response.text).not.toContain(bCustomStage);
  });

  it("KPI, canali, serie e segmenti del tenant A escludono i dati del tenant B", async () => {
    const token = A().users.analyst.token;
    const channels = await env.request<Array<{ channel: string }>>("GET", "/api/channels?from=2020-01-01&to=2030-12-31", { token });
    expect(channels.status).toBe(200);
    expect(channels.text).not.toContain("Referral"); // canale presente solo nel tenant B
    const segments = await env.request("GET", "/api/segments?from=2020-01-01&to=2030-12-31", { token });
    expect(segments.status).toBe(200);
    expect(segments.text).not.toContain("Referral");
    const segmentCustomers = await env.request("GET", "/api/segments/customers?dimension=channel&id=Referral&from=2020-01-01&to=2030-12-31", { token });
    expect(JSON.stringify(segmentCustomers.body)).not.toContain(bReferralCustomerId === "" ? "x" : `"id":"${bReferralCustomerId}"`);
    expect(segmentCustomers.text).not.toContain("Solo B");
  });

  it("l'export CSV del tenant A non contiene clienti o eventi del tenant B", async () => {
    const response = await env.request("GET", "/api/export/customers.csv", { token: A().users.analyst.token });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("b-referral-secret");
    expect(response.text).not.toContain("Solo B");
  });

  it("lo stesso externalId può esistere in entrambi i tenant senza collisioni né rivelazioni", async () => {
    // `shared-ext-1` è presente in A e in B; `only-b-2` solo in B: A può crearlo come proprio.
    const before = await snapshotTenant("B");
    const created = await env.request<{ id: string }>("POST", "/api/customers", {
      token: A().users.editor.token, body: { externalId: "only-b-2", channel: "Social", createdAt: "2026-05-01" },
    });
    expect(created.status).toBe(201);
    const owner = await env.adminPool.query("SELECT organization_id::text AS org FROM customers WHERE id=$1::bigint", [created.body.id]);
    expect(owner.rows[0]!.org).toBe(A().id);
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("la registro attività del tenant A non mostra voci del tenant B", async () => {
    const response = await env.request<{ data: Array<{ id: string }>; pagination: { total: number } }>(
      "GET", "/api/audit?limit=100", { token: A().users.admin.token });
    expect(response.status).toBe(200);
    const expected = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1", [A().id]);
    expect(response.body.pagination.total).toBe(expected.rows[0]!.n);
    const foreign = await env.adminPool.query("SELECT id::text FROM audit_logs WHERE organization_id=$1", [B().id]);
    const seen = new Set(response.body.data.map((row) => String(row.id)));
    for (const row of foreign.rows) expect(seen.has(row.id)).toBe(false);
  });
});

describe.skipIf(!dbUrl)("Multi-tenant — FUNNEL", () => {
  it("l'elenco fasi del tenant A non rivela fasi personalizzate del tenant B", async () => {
    const response = await env.request<Array<{ id: string; label: string }>>(
      "GET", "/api/funnel-stages", { token: A().users.admin.token });
    expect(response.status).toBe(200);
    expect(response.body.some((stage) => stage.id === bCustomStage)).toBe(false);
    expect(response.text).not.toContain("Solo B");
  });

  it("modificare una fase del tenant B dal tenant A restituisce 404 senza cambiare B", async () => {
    const before = await snapshotTenant("B");
    const response = await env.request("PUT", `/api/funnel-stages/${bCustomStage}`, {
      token: A().users.admin.token, body: { label: "Tentativo di modifica" },
    });
    expect(response.status).toBe(404);
    expect(response.text).not.toContain("Solo B");
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("riordinare le fasi del tenant A includendo una fase di B viene rifiutato senza scritture", async () => {
    const beforeA = await snapshotTenant("A");
    const beforeB = await snapshotTenant("B");
    const listed = await env.request<Array<{ id: string }>>(
      "GET", "/api/funnel-stages", { token: A().users.admin.token });
    const response = await env.request("PUT", "/api/funnel-stages/reorder", {
      token: A().users.admin.token,
      body: { stages: [...listed.body.map((stage) => stage.id), bCustomStage] },
    });
    expect(response.status).toBe(400);
    expect(await snapshotTenant("A")).toEqual(beforeA);
    expect(await snapshotTenant("B")).toEqual(beforeB);
  });
});

describe.skipIf(!dbUrl)("Multi-tenant — IMPORTAZIONI", () => {
  it("importare externalId già usati dal tenant B è lecito e non altera il tenant B", async () => {
    const before = await snapshotTenant("B");
    const response = await env.request<{ importedCustomers: number }>("POST", "/api/import", {
      token: A().users.editor.token,
      body: { fileName: "a.csv", rows: [importRow("b-referral-secret"), importRow("shared-ext-9")] },
    });
    expect(response.status).toBe(201);
    expect(response.body.importedCustomers).toBe(2);
    const owners = await env.adminPool.query(
      "SELECT DISTINCT organization_id::text AS org FROM customers WHERE external_id IN ('shared-ext-9') OR (external_id='b-referral-secret' AND organization_id=$1)", [A().id]);
    expect(owners.rows.map((row) => row.org)).toEqual([A().id]);
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("l'impronta anti-duplicato è per tenant: stesso contenuto accettato in B, rifiutato (409) su A alla seconda volta", async () => {
    const rows = [importRow("fingerprint-probe", { createdAt: "2026-06-01", occurredAt: "2026-06-01" })];
    expect((await env.request("POST", "/api/import", { token: A().users.admin.token, body: { fileName: "p.csv", rows } })).status).toBe(201);
    expect((await env.request("POST", "/api/import", { token: B().users.admin.token, body: { fileName: "p.csv", rows } })).status).toBe(201);
    const again = await env.request("POST", "/api/import", { token: A().users.admin.token, body: { fileName: "p.csv", rows } });
    expect(again.status).toBe(409);
  });

  it("un organizationId nel body o nelle righe viene ignorato: i dati finiscono sempre nel tenant della sessione", async () => {
    const before = await snapshotTenant("B");
    const response = await env.request("POST", "/api/import", {
      token: A().users.admin.token,
      body: {
        fileName: "override.csv", organization_id: B().id, organizationId: B().id,
        rows: [importRow("override-1", { organizationId: B().id, organization_id: B().id, createdAt: "2026-07-01", occurredAt: "2026-07-01" })],
      },
    });
    expect(response.status).toBe(201);
    const row = await env.adminPool.query("SELECT organization_id::text AS org FROM customers WHERE external_id='override-1'");
    expect(row.rows).toEqual([{ org: A().id }]);
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("una fase esistente solo nel tenant B è rifiutata (400) e nessun dato viene scritto in A né in B", async () => {
    const beforeA = await snapshotTenant("A");
    const beforeB = await snapshotTenant("B");
    const response = await env.request("POST", "/api/import", {
      token: A().users.admin.token,
      body: { fileName: "stage.csv", rows: [importRow("stage-probe"), importRow("stage-probe", { stage: bCustomStage, occurredAt: "2026-04-02" })] },
    });
    expect(response.status).toBe(400);
    expect(await snapshotTenant("A")).toEqual(beforeA);
    expect(await snapshotTenant("B")).toEqual(beforeB);
  });

  it("rollback atomico: se un cliente del file collide, NESSUN cliente, evento, batch o audit del file resta", async () => {
    const before = await snapshotTenant("A");
    const response = await env.request("POST", "/api/import", {
      token: A().users.admin.token,
      body: { fileName: "rollback.csv", rows: [importRow("rollback-new-1", { createdAt: "2026-08-01", occurredAt: "2026-08-01" }), importRow("shared-ext-1", { createdAt: "2026-08-02", occurredAt: "2026-08-02" })] },
    });
    expect(response.status).toBe(409);
    const leaked = await env.adminPool.query("SELECT 1 FROM customers WHERE external_id='rollback-new-1'");
    expect(leaked.rowCount).toBe(0);
    expect(await snapshotTenant("A")).toEqual(before);
  });

  it("oltre 10.000 righe → 400; oltre il limite di dimensione → 413; nessuna scrittura", async () => {
    const before = await snapshotTenant("A");
    const tooMany = await env.request("POST", "/api/import", {
      token: A().users.admin.token,
      body: { fileName: "many.csv", rows: Array.from({ length: 10_001 }, (_, i) => importRow(`many-${i}`)) },
    });
    expect(tooMany.status).toBe(400);
    const tooLarge = await env.request("POST", "/api/import", {
      token: A().users.admin.token, rawBody: JSON.stringify({ fileName: "x.csv", rows: [], pad: "x".repeat(12 * 1024 * 1024 + 10) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(await snapshotTenant("A")).toEqual(before);
  });
});

describe.skipIf(!dbUrl)("Multi-tenant — MEMBRI", () => {
  it("l'elenco membri del tenant A contiene solo gli utenti di A", async () => {
    const response = await env.request<Array<{ userId: string; email: string }>>("GET", "/api/members", { token: A().users.admin.token });
    expect(response.status).toBe(200);
    expect(response.body.map((member) => member.userId).sort()).toEqual(Object.values(A().users).map((user) => user.id).sort());
    expect(response.text).not.toMatch(/\.b@example\.test/);
  });

  it("PATCH su un membro del tenant B (membershipId o userId) → 404 e B invariato", async () => {
    const before = await snapshotTenant("B");
    for (const target of [B().users.admin.membershipId, B().users.viewer.membershipId, B().users.viewer.id]) {
      for (const body of [{ role: "viewer" }, { status: "suspended" }, { role: "admin" }]) {
        const response = await env.request("PATCH", `/api/members/${target}`, { token: A().users.admin.token, body });
        expect(response.status).toBe(404);
      }
    }
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("mass assignment: organizationId/userId nel body non spostano il membro né toccano B (invarianti valide in ogni caso)", async () => {
    const before = await snapshotTenant("B");
    const target = A().users.viewer;
    const response = await env.request("PATCH", `/api/members/${target.membershipId}`, {
      token: A().users.admin.token,
      body: { role: "analyst", organizationId: B().id, organization_id: B().id, userId: B().users.admin.id },
    });
    expect(response.status).not.toBe(403);
    // Qualunque sia l'esito (200 oppure 500 per la lacuna nota più sotto), la membership
    // resta nel tenant A, appartiene allo stesso utente e il tenant B non cambia.
    const row = await env.adminPool.query("SELECT organization_id::text AS org, user_id::text AS uid FROM memberships WHERE id=$1", [target.membershipId]);
    expect(row.rows[0]).toEqual({ org: A().id, uid: target.id });
    expect(await snapshotTenant("B")).toEqual(before);
    await env.adminPool.query("UPDATE memberships SET role='viewer', status='active' WHERE id=$1", [target.membershipId]);
  });

  it("solo role/status sono modificabili: un body con soli campi estranei è rifiutato (400)", async () => {
    const response = await env.request("PATCH", `/api/members/${A().users.viewer.membershipId}`, {
      token: A().users.admin.token, body: { organizationId: B().id },
    });
    expect(response.status).toBe(400);
  });

  it("un amministratore non può modificare il proprio accesso (409)", async () => {
    const response = await env.request("PATCH", `/api/members/${A().users.admin.membershipId}`, {
      token: A().users.admin.token, body: { role: "viewer" },
    });
    expect(response.status).toBe(409);
  });

  it("utente presente in DUE tenant: il ruolo e i dati dipendono dalla sessione, mai dall'altro tenant", async () => {
    const multi = await env.adminPool.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, full_name, status) SELECT 'multi@example.test', password_hash, 'Multi', 'active' FROM users WHERE email='admin.a@example.test' RETURNING id::text AS id");
    const userId = multi.rows[0]!.id;
    await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'admin'), ($3,$2,'viewer')", [A().id, userId, B().id]);
    const tokenA = await env.newSession(userId, A().id);
    const tokenB = await env.newSession(userId, B().id);

    // Con la sessione del tenant B (viewer) non si amministra nulla, nemmeno A.
    expect((await env.request("GET", "/api/members", { token: tokenB })).status).toBe(403);
    // Con la sessione di A (admin) si vedono solo i membri di A.
    const members = await env.request<Array<{ userId: string }>>("GET", "/api/members", { token: tokenA });
    expect(members.status).toBe(200);
    expect(members.text).not.toMatch(/\.b@example\.test/);
    // Le sessioni elencate sono quelle del tenant corrente; revocare quella dell'altro tenant → 404.
    const listA = await env.request<{ sessions: Array<{ id: string }> }>("GET", "/api/account/sessions", { token: tokenA });
    const sessionBId = (await env.adminPool.query<{ id: string }>("SELECT id::text AS id FROM sessions WHERE user_id=$1 AND organization_id=$2", [userId, B().id])).rows[0]!.id;
    expect(listA.body.sessions.map((s) => s.id)).not.toContain(sessionBId);
    expect((await env.request("DELETE", `/api/account/sessions/${sessionBId}`, { token: tokenA })).status).toBe(404);
    expect((await env.request("GET", "/api/account", { token: tokenB })).status).toBe(200);
  });
});

describe.skipIf(!dbUrl)("Multi-tenant — INVITI", () => {
  it("l'elenco inviti del tenant A non contiene inviti del tenant B", async () => {
    const response = await env.request("GET", "/api/invitations", { token: A().users.admin.token });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("invitato-b@example.test");
    expect(response.text).not.toContain(bInviteId);
  });

  it("revocare un invito del tenant B dal tenant A → 404 e l'invito di B resta valido", async () => {
    const before = await snapshotTenant("B");
    const response = await env.request("POST", `/api/invitations/${bInviteId}/revoke`, { token: A().users.admin.token });
    expect(response.status).toBe(404);
    expect(await snapshotTenant("B")).toEqual(before);
    const stillValid = await env.adminPool.query("SELECT revoked_at FROM invitations WHERE id=$1", [bInviteId]);
    expect(stillValid.rows[0]!.revoked_at).toBeNull();
  });

  it("invitare un indirizzo che è membro di B non rivela nulla di B; invitare un membro di A dà 409", async () => {
    const fresh = await env.request("POST", "/api/invitations", { token: A().users.admin.token, body: { email: "mai-visto@example.test", role: "viewer" } });
    const bMember = await env.request("POST", "/api/invitations", { token: A().users.admin.token, body: { email: B().users.viewer.email, role: "viewer" } });
    expect(fresh.status).toBe(201);
    expect(bMember.status).toBe(201);
    expect(Object.keys(bMember.body as object).sort()).toEqual(Object.keys(fresh.body as object).sort());
    expect(bMember.text).not.toMatch(/tenant-b|Tenant B/);
    const aMember = await env.request("POST", "/api/invitations", { token: A().users.admin.token, body: { email: A().users.viewer.email, role: "viewer" } });
    expect(aMember.status).toBe(409);
  });

  it("accettare un invito di A per un account esistente di B richiede la password: con password errata → 401 e nessuna membership", async () => {
    const created = await env.request<{ inviteUrl: string }>("POST", "/api/invitations", {
      token: A().users.admin.token, body: { email: B().users.editor.email, role: "admin" },
    });
    expect(created.status, created.text).toBe(201);
    const token = new URLSearchParams(new URL(created.body.inviteUrl).hash.slice(1)).get("token");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const before = await snapshotTenant("B");
    const wrong = await env.request("POST", "/api/invitations/accept", { body: { token, fullName: "Attaccante", password: "Password-sbagliata-123" } });
    expect(wrong.status, wrong.text).toBe(401);
    const none = await env.adminPool.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2", [A().id, B().users.editor.id]);
    expect(none.rowCount).toBe(0);
    // Con la password corretta la membership nasce SOLO in A e quella in B non cambia.
    const ok = await env.request("POST", "/api/invitations/accept", { body: { token, fullName: "Editor B", password: TEST_PASSWORD } });
    expect(ok.status).toBe(200);
    const memberships = await env.adminPool.query("SELECT organization_id::text AS org, role FROM memberships WHERE user_id=$1 ORDER BY role", [B().users.editor.id]);
    expect(memberships.rows).toEqual(expect.arrayContaining([{ org: A().id, role: "admin" }, { org: B().id, role: "editor" }]));
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("ruolo e organizzazione derivano dall'invito: role/organizationId nel body di accettazione sono ignorati", async () => {
    const token = randomBytes(32).toString("base64url");
    await env.adminPool.query(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1,'escalation@example.test','viewer',$2,$3, NOW() + INTERVAL '1 day')`,
      [A().id, sha256(token), A().users.admin.id]);
    const before = await snapshotTenant("B");
    const response = await env.request<{ organizationSlug: string }>("POST", "/api/invitations/accept", {
      body: { token, fullName: "Escalation", password: "Una-Password-Lunga-2026", role: "admin", organizationId: B().id, organizationSlug: "tenant-b" },
    });
    expect(response.status).toBe(200);
    expect(response.body.organizationSlug).toBe("tenant-a");
    const membership = await env.adminPool.query("SELECT organization_id::text AS org, role FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='escalation@example.test'");
    expect(membership.rows).toEqual([{ org: A().id, role: "viewer" }]);
    expect(await snapshotTenant("B")).toEqual(before);
  });

  it("invito scaduto o revocato → 400 senza creare utenti né membership", async () => {
    const expired = randomBytes(32).toString("base64url");
    const revoked = randomBytes(32).toString("base64url");
    await env.adminPool.query(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at, revoked_at) VALUES
       ($1,'scaduto@example.test','viewer',$2,$4, NOW() - INTERVAL '1 minute', NULL),
       ($1,'revocato@example.test','viewer',$3,$4, NOW() + INTERVAL '1 day', NOW())`,
      [A().id, sha256(expired), sha256(revoked), A().users.admin.id]);
    for (const token of [expired, revoked]) {
      const response = await env.request("POST", "/api/invitations/accept", { body: { token, fullName: "Nessuno", password: "Una-Password-Lunga-2026" } });
      expect(response.status).toBe(400);
    }
    const created = await env.adminPool.query("SELECT 1 FROM users WHERE email IN ('scaduto@example.test','revocato@example.test')");
    expect(created.rowCount).toBe(0);
  });

  it("il token di un invito di B è utilizzabile solo per B: il nuovo utente vede esclusivamente i dati di B", async () => {
    const accepted = await env.request<{ organizationSlug: string }>("POST", "/api/invitations/accept", {
      body: { token: bInviteToken, fullName: "Invitato B", password: "Una-Password-Lunga-2026" },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.organizationSlug).toBe("tenant-b");
    const user = await env.adminPool.query<{ id: string }>("SELECT id::text AS id FROM users WHERE email='invitato-b@example.test'");
    const token = await env.newSession(user.rows[0]!.id, B().id);
    const customers = await env.request<{ data: Array<{ id: string }> }>("GET", "/api/customers?limit=100", { token });
    const ids = customers.body.data.map((c) => c.id);
    for (const id of A().customerIds) expect(ids).not.toContain(id);
  });
});

describe.skipIf(!dbUrl)("Multi-tenant — difesa in profondità: RLS del database con il ruolo runtime", () => {
  async function withTenant<T>(orgId: string | null, work: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>) => Promise<T>): Promise<T> {
    const client = await env.runtimePool.connect();
    try {
      await client.query("BEGIN");
      if (orgId) await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgId]);
      return await work((sql, params) => client.query(sql, params) as never);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }
  const TENANT_TABLES = ["customers", "events", "funnel_stages", "import_batches", "audit_logs", "invitations"];

  it("il ruolo runtime non è owner, superuser né BYPASSRLS", async () => {
    const role = await env.runtimePool.query("SELECT rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false });
    const owned = await env.runtimePool.query("SELECT relname FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND relkind='r'");
    expect(owned.rows).toEqual([]);
  });

  it.each(TENANT_TABLES)("senza contesto tenant la tabella %s non restituisce nessuna riga", async (table) => {
    const rows = await withTenant(null, (q) => q(`SELECT COUNT(*)::int AS n FROM ${table}`));
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("con contesto A il database non mostra, non modifica e non cancella righe di B", async () => {
    await withTenant(A().id, async (q) => {
      expect((await q("SELECT 1 FROM customers WHERE organization_id=$1", [B().id])).rowCount).toBe(0);
      expect((await q("SELECT 1 FROM events WHERE organization_id=$1", [B().id])).rowCount).toBe(0);
      expect((await q("SELECT 1 FROM funnel_stages WHERE organization_id=$1", [B().id])).rowCount).toBe(0);
      expect((await q("SELECT 1 FROM invitations WHERE organization_id=$1", [B().id])).rowCount).toBe(0);
      expect((await q("UPDATE customers SET channel='Email' WHERE organization_id=$1", [B().id])).rowCount).toBe(0);
      expect((await q("DELETE FROM events WHERE organization_id=$1", [B().id])).rowCount).toBe(0);
      expect((await q("DELETE FROM customers WHERE id=$1::bigint", [B().customerIds[0]])).rowCount).toBe(0);
    });
  });

  it("con contesto A, scrivere una riga per B viene respinto dalla policy WITH CHECK", async () => {
    await expect(withTenant(A().id, (q) => q(
      "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'rls-probe','Email', NOW())", [B().id],
    ))).rejects.toMatchObject({ code: "42501" });
    await expect(withTenant(A().id, (q) => q(
      "INSERT INTO audit_logs (organization_id, actor_user_id, action) VALUES ($1,$2,'rls.probe')", [B().id, A().users.admin.id],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("con contesto A, un evento di A non può referenziare un cliente di B (FK composita)", async () => {
    await expect(withTenant(A().id, (q) => q(
      "INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit',NOW())", [A().id, B().customerIds[0]],
    ))).rejects.toMatchObject({ code: "23503" });
  });

  it("il lookup dell'invito per token vede solo quell'invito, mai gli altri tenant", async () => {
    const rows = await withTenant(null, async (q) => {
      await q("SELECT set_config('app.invitation_token_hash', $1, true)", [sha256(bInviteToken)]);
      return q("SELECT id::text AS id, organization_id::text AS org FROM invitations");
    });
    expect(rows.rows.every((row) => row.id === bInviteId)).toBe(true);
    expect(rows.rows.length).toBeLessThanOrEqual(1);
  });

  it("il ruolo runtime non può aggiornare o cancellare l'audit né cancellare inviti/membership", async () => {
    await withTenant(A().id, async (q) => {
      await expect(q("UPDATE audit_logs SET action='x'")).rejects.toMatchObject({ code: "42501" });
    });
    await withTenant(A().id, async (q) => {
      await expect(q("DELETE FROM audit_logs")).rejects.toMatchObject({ code: "42501" });
    });
    await withTenant(A().id, async (q) => {
      await expect(q("DELETE FROM memberships")).rejects.toMatchObject({ code: "42501" });
    });
  });
});

/**
 * Regressioni sui difetti trovati con questi test e poi corretti:
 *  - PATCH /api/members/:id rispondeva sempre 500 (query di audit senza cast dei parametri);
 *  - errori di input del client (ID, fasi, parametri) rispondevano 500 invece di 4xx.
 * Ora gli errori del client sono 400/409 con messaggio chiaro; gli errori interni restano 500.
 */
describe.skipIf(!dbUrl)("Regressioni: input del client → 4xx, cambio membro funzionante", () => {
  const admin = () => A().users.admin.token;

  it("PATCH /api/members/:id cambia ruolo e stato (200), scrive l'audit e ha effetto immediato sulla sessione", async () => {
    const target = A().users.viewer;
    const token = await env.newSession(target.id, A().id);
    const lastAudit = Number((await env.adminPool.query("SELECT COALESCE(MAX(id),0) AS n FROM audit_logs")).rows[0]!.n);
    try {
      const promoted = await env.request<{ role: string }>("PATCH", `/api/members/${target.membershipId}`, { token: admin(), body: { role: "analyst" } });
      expect(promoted.status).toBe(200);
      expect(promoted.body.role).toBe("analyst");
      expect((await env.request("GET", "/api/export/customers.csv", { token })).status).toBe(200); // ora analyst può esportare
      const suspended = await env.request("PATCH", `/api/members/${target.membershipId}`, { token: admin(), body: { status: "suspended" } });
      expect(suspended.status).toBe(200);
      expect((await env.request("GET", "/api/account", { token })).status).toBe(401);
      const audit = await env.adminPool.query(
        "SELECT details FROM audit_logs WHERE organization_id=$1 AND action='membership.updated' AND resource_id=$2 AND id > $3 ORDER BY id", [A().id, target.membershipId, lastAudit]);
      expect(audit.rows.map((r) => r.details)).toEqual([
        { previousRole: "viewer", role: "analyst", previousStatus: "active", status: "active" },
        { previousRole: "analyst", role: "analyst", previousStatus: "active", status: "suspended" },
      ]);
    } finally {
      await env.adminPool.query("UPDATE memberships SET role='viewer', status='active' WHERE id=$1", [target.membershipId]);
    }
  });

  const cases: Array<[string, string, string, unknown, number]> = [
    ["DELETE cliente con ID non numerico", "DELETE", "/api/customers/abc", undefined, 400],
    ["PUT cliente con ID non numerico", "PUT", "/api/customers/abc", { externalId: "x", channel: "Email", createdAt: "2026-01-01" }, 400],
    ["POST cliente con fase sconosciuta", "POST", "/api/customers", { externalId: "z1", channel: "Email", createdAt: "2026-01-10", events: [{ stage: "inesistente", occurredAt: "2026-01-11" }] }, 400],
    ["PUT fase con nome troppo lungo", "PUT", "/api/funnel-stages/lead", { label: "x".repeat(80) }, 400],
    ["PUT fase senza modifiche valide", "PUT", "/api/funnel-stages/lead", {}, 400],
    ["PUT fase con isActive non booleano", "PUT", "/api/funnel-stages/lead", { isActive: "yes" }, 400],
    ["PUT fase: disattivare Visita", "PUT", "/api/funnel-stages/visit", { isActive: false }, 400],
    ["riordino con ID sconosciuto", "PUT", "/api/funnel-stages/reorder", { stages: ["00000000-0000-4000-8000-000000000000"] }, 400],
    ["segmenti: clienti senza parametri", "GET", "/api/segments/customers", undefined, 400],
    ["segmenti: dimensione sconosciuta", "GET", "/api/segments/customers?dimension=x&id=y", undefined, 400],
    ["nuova fase con nome già esistente", "POST", "/api/funnel-stages", { label: "Lead" }, 409],
  ];
  it.each(cases)("%s → %i", async (_name, method, path, body, status) => {
    const beforeA = await snapshotTenant("A");
    const response = await env.request<{ error: string }>(method, path, { token: admin(), body });
    expect(response.status).toBe(status);
    expect(response.body.error).toMatch(/\S/);
    expect(response.body.error).not.toMatch(/Errore interno/);
    expect(await snapshotTenant("A")).toEqual(beforeA); // un input errato non modifica mai i dati
  });

  it("gli errori interni restano 500 e non rivelano dettagli (nessun SQL, nessuna stringa di connessione)", async () => {
    const spy = await env.adminPool.query("SELECT 1"); // il database è raggiungibile: forziamo un errore interno revocando un privilegio
    expect(spy.rowCount).toBe(1);
    await env.adminPool.query(`REVOKE SELECT ON funnel_stages FROM "${env.runtimeRole}"`);
    try {
      const response = await env.request<{ error: string }>("GET", "/api/funnel-stages", { token: admin() });
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Errore interno del server." });
    } finally {
      await env.adminPool.query(`GRANT SELECT ON funnel_stages TO "${env.runtimeRole}"`);
    }
  });
});
