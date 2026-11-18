import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresApp } from "../src/postgres-app.js";
import {
  ROLES, ORIGIN, createHttpTestEnvironment, integrationDatabaseUrl,
  type HttpTestEnvironment, type Role,
} from "./helpers/http-test-environment.js";

/**
 * Matrice sistematica di autorizzazione: 4 ruoli x ogni endpoint /api.
 *
 * Le aspettative sono scritte QUI in modo indipendente dal codice di produzione
 * (non importano ROLE_PERMISSIONS): se la policy cambia, il test deve fallire.
 * Un test di completezza confronta le route registrate in Express con la matrice,
 * quindi un nuovo endpoint senza copertura fa fallire la suite.
 */

const READ_ALL: Role[] = ["admin", "editor", "analyst", "viewer"];
const WRITE: Role[] = ["admin", "editor"];
const EXPORT: Role[] = ["admin", "editor", "analyst"];
const ADMIN_ONLY: Role[] = ["admin"];

interface Ctx {
  env: HttpTestEnvironment; customerToDelete: string; customerToUpdate: string;
  inviteToRevoke: string; viewerMembershipId: string;
}
interface Endpoint {
  id: string; method: string; path: (c: Ctx) => string; allowed: Role[];
  /** Richiesta valida che MUTEREBBE lo stato se il gate fallisse (usata dai ruoli negati). */
  mutating?: (c: Ctx) => unknown;
  /** Richiesta innocua che supera il gate (usata dai ruoli ammessi) e stato atteso. */
  probe?: (c: Ctx) => unknown;
  /** Percorso alternativo, non distruttivo, per il probe dei ruoli ammessi (es. ID inesistente). */
  probePath?: (c: Ctx) => string;
  probeStatus: number;
}

const NIL = "00000000-0000-4000-8000-000000000000";
const ENDPOINTS: Endpoint[] = [
  { id: "GET /api/meta", method: "GET", path: () => "/api/meta", allowed: READ_ALL, probeStatus: 200 },
  { id: "GET /api/summary", method: "GET", path: () => "/api/summary", allowed: READ_ALL, probeStatus: 200 },
  { id: "GET /api/channels", method: "GET", path: () => "/api/channels", allowed: READ_ALL, probeStatus: 200 },
  { id: "GET /api/timeseries", method: "GET", path: () => "/api/timeseries", allowed: READ_ALL, probeStatus: 200 },
  { id: "GET /api/segments", method: "GET", path: () => "/api/segments", allowed: READ_ALL, probeStatus: 200 },
  { id: "GET /api/segments/customers", method: "GET", path: () => "/api/segments/customers?dimension=channel&id=Email", allowed: READ_ALL, probeStatus: 200 },
  { id: "GET /api/customers", method: "GET", path: () => "/api/customers", allowed: READ_ALL, probeStatus: 200 },
  { id: "POST /api/customers", method: "POST", path: () => "/api/customers", allowed: WRITE,
    mutating: () => ({ externalId: "matrix-denied-create", channel: "Email", createdAt: "2026-02-01" }),
    probe: () => ({ channel: "canale-inesistente" }), probeStatus: 400 },
  { id: "PUT /api/customers/:id", method: "PUT", path: (c) => `/api/customers/${c.customerToUpdate}`, allowed: WRITE,
    mutating: () => ({ externalId: "matrix-denied-update", channel: "Referral", createdAt: "2026-01-10" }),
    probe: () => ({ channel: "canale-inesistente" }), probeStatus: 400 },
  { id: "DELETE /api/customers/:id", method: "DELETE", path: (c) => `/api/customers/${c.customerToDelete}`, allowed: WRITE,
    mutating: () => undefined, probePath: () => "/api/customers/999999999", probeStatus: 404 },
  { id: "GET /api/funnel-stages", method: "GET", path: () => "/api/funnel-stages", allowed: READ_ALL, probeStatus: 200 },
  { id: "POST /api/funnel-stages", method: "POST", path: () => "/api/funnel-stages", allowed: WRITE,
    mutating: () => ({ label: "Fase negata" }), probe: () => ({ label: "" }), probeStatus: 400 },
  { id: "PUT /api/funnel-stages/reorder", method: "PUT", path: () => "/api/funnel-stages/reorder", allowed: WRITE,
    mutating: () => ({ stages: ["visit", "qualified", "lead", "opportunity", "customer"] }),
    probe: () => ({ stages: "non-un-array" }), probeStatus: 400 },
  { id: "PUT /api/funnel-stages/:id", method: "PUT", path: () => "/api/funnel-stages/lead", allowed: WRITE,
    mutating: () => ({ label: "Hijacked" }), probe: () => ({ label: "valido" }),
    probePath: () => "/api/funnel-stages/fase-inesistente", probeStatus: 404 },
  { id: "POST /api/import", method: "POST", path: () => "/api/import", allowed: WRITE,
    mutating: () => ({ fileName: "denied.csv", rows: [{ externalId: "matrix-denied-import", channel: "Email", createdAt: "2026-03-01", stage: "visit", occurredAt: "2026-03-01" }] }),
    probe: () => ({ fileName: "x.csv", rows: "non-un-array" }), probeStatus: 400 },
  { id: "GET /api/export/organization.json", method: "GET", path: () => "/api/export/organization.json", allowed: EXPORT, probeStatus: 200 },
  { id: "GET /api/export/customers.csv", method: "GET", path: () => "/api/export/customers.csv", allowed: EXPORT, probeStatus: 200 },
  { id: "GET /api/audit", method: "GET", path: () => "/api/audit", allowed: ADMIN_ONLY, probeStatus: 200 },
  { id: "GET /api/organization", method: "GET", path: () => "/api/organization", allowed: ADMIN_ONLY, probeStatus: 200 },
  { id: "PATCH /api/organization", method: "PATCH", path: () => "/api/organization", allowed: ADMIN_ONLY,
    mutating: () => ({ name: "Organizzazione Hijacked" }), probe: () => ({ unknownKey: 1 }), probeStatus: 400 },
  { id: "GET /api/members", method: "GET", path: () => "/api/members", allowed: ADMIN_ONLY, probeStatus: 200 },
  { id: "PATCH /api/members/:id", method: "PATCH", path: (c) => `/api/members/${c.viewerMembershipId}`, allowed: ADMIN_ONLY,
    mutating: () => ({ role: "admin" }), probe: () => ({ role: "ruolo-inesistente" }), probeStatus: 400 },
  { id: "GET /api/invitations", method: "GET", path: () => "/api/invitations", allowed: ADMIN_ONLY, probeStatus: 200 },
  { id: "POST /api/invitations", method: "POST", path: () => "/api/invitations", allowed: ADMIN_ONLY,
    mutating: () => ({ email: "escalation@example.test", role: "admin" }), probe: () => ({ email: "non-una-email", role: "admin" }), probeStatus: 400 },
  { id: "POST /api/invitations/:id/revoke", method: "POST", path: (c) => `/api/invitations/${c.inviteToRevoke}/revoke`, allowed: ADMIN_ONLY,
    mutating: () => undefined, probePath: () => `/api/invitations/${NIL}/revoke`, probeStatus: 404 },
];

/** Endpoint che richiedono solo una sessione valida (qualsiasi ruolo). */
const SESSION_ONLY = [
  { id: "GET /api/auth/session", method: "GET", path: "/api/auth/session", body: undefined, status: 200 },
  { id: "GET /api/account", method: "GET", path: "/api/account", body: undefined, status: 200 },
  { id: "PATCH /api/account", method: "PATCH", path: "/api/account", body: {}, status: 400 },
  { id: "POST /api/account/password", method: "POST", path: "/api/account/password", body: { currentPassword: "x" }, status: 400 },
  { id: "GET /api/account/sessions", method: "GET", path: "/api/account/sessions", body: undefined, status: 200 },
  { id: "DELETE /api/account/sessions/:id", method: "DELETE", path: `/api/account/sessions/${NIL}`, body: undefined, status: 404 },
  { id: "POST /api/auth/logout", method: "POST", path: "/api/auth/logout", body: undefined, status: 204 },
] as const;

/** Endpoint pubblici: raggiungibili senza sessione. */
const PUBLIC = new Set([
  "GET /api/health", "POST /api/invitations/accept", "POST /api/auth/login",
  "POST /api/auth/password-reset/request", "POST /api/auth/password-reset/complete",
]);

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
let ctx: Ctx;
const routeKeys: string[] = [];

async function snapshot(): Promise<Record<string, unknown>> {
  const q = async (sql: string) => (await env.adminPool.query(sql)).rows;
  return {
    counts: await q(`SELECT (SELECT COUNT(*) FROM customers) c, (SELECT COUNT(*) FROM events) e,
      (SELECT COUNT(*) FROM funnel_stages) f, (SELECT COUNT(*) FROM memberships) m,
      (SELECT COUNT(*) FROM invitations) i, (SELECT COUNT(*) FROM import_batches) b,
      (SELECT COUNT(*) FROM audit_logs) a, (SELECT COUNT(*) FROM users) u`),
    orgs: await q("SELECT id, name, status FROM organizations ORDER BY id"),
    members: await q("SELECT id, role, status FROM memberships ORDER BY id"),
    stages: await q("SELECT organization_id, id, label, position, is_active FROM funnel_stages ORDER BY organization_id, id"),
    customers: await q("SELECT id, external_id, channel, created_at FROM customers ORDER BY id"),
    invitations: await q("SELECT id, revoked_at, accepted_at FROM invitations ORDER BY id"),
  };
}

beforeAll(async () => {
  if (!dbUrl) return;
  env = await createHttpTestEnvironment();
  const a = env.tenants.A;
  const invite = await env.adminPool.query<{ id: string }>(
    `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, 'pending@example.test', 'viewer', $2, $3, NOW() + INTERVAL '7 days') RETURNING id::text AS id`,
    [a.id, "f".repeat(64), a.users.admin.id],
  );
  ctx = {
    env, customerToUpdate: a.customerIds[0]!, customerToDelete: a.customerIds[1]!,
    inviteToRevoke: invite.rows[0]!.id, viewerMembershipId: a.users.viewer.membershipId,
  };
  // Route registrate realmente in Express (per il test di completezza).
  type Layer = { route?: { path: string; methods: Record<string, boolean> }; name?: string; regexp?: RegExp; handle?: { stack?: Layer[] } };
  const app = createPostgresApp(env.runtimePool, {
    allowedOrigins: [ORIGIN], rateLimitSecret: "x".repeat(40), production: false,
  }) as unknown as { _router: { stack: Layer[] } };
  const collect = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) routeKeys.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      } else if (layer.name === "router" && layer.handle?.stack) {
        collect(layer.handle.stack, /auth/.test(String(layer.regexp)) ? "/api/auth" : "");
      }
    }
  };
  collect(app._router.stack, "");
}, 60_000);

afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Matrice di autorizzazione: ruoli x endpoint (PostgreSQL reale, RLS attiva)", () => {
  it("copre TUTTE le route /api registrate (nessun endpoint senza test di ruolo)", () => {
    const api = routeKeys.filter((key) => key.split(" ")[1]!.startsWith("/api"));
    expect(api.length).toBeGreaterThan(30);
    const normalize = (key: string) => key.replace(/:\w+/g, ":id");
    const covered = new Set([
      ...ENDPOINTS.map((e) => normalize(e.id)),
      ...SESSION_ONLY.map((e) => normalize(e.id)),
      ...[...PUBLIC].map(normalize),
    ]);
    const normalizedApi = api.map(normalize);
    const unknown = normalizedApi.filter((key) => !covered.has(key));
    expect(unknown, `Route senza copertura nella matrice: ${unknown.join(", ")}`).toEqual([]);
    const stale = [...covered].filter((key) => !normalizedApi.includes(key));
    expect(stale, `Voci della matrice senza route reale: ${stale.join(", ")}`).toEqual([]);
  });

  describe.each(ENDPOINTS)("$id", (endpoint) => {
    it("401 senza sessione, con cookie malformato e con token inesistente", async () => {
      const body = endpoint.mutating?.(ctx);
      const anonymous = await env.request(endpoint.method, endpoint.path(ctx), { body });
      expect(anonymous.status).toBe(401);
      const malformed = await env.request(endpoint.method, endpoint.path(ctx), { body, rawCookie: "percorso_session=non-valido" });
      expect(malformed.status).toBe(401);
      const unknownToken = await env.request(endpoint.method, endpoint.path(ctx), { body, token: "A".repeat(43) });
      expect(unknownToken.status).toBe(401);
    });

    it.each(ROLES.filter((role) => !endpoint.allowed.includes(role)))(
      "%s è NEGATO (403) e lo stato del database resta invariato",
      async (role) => {
        const before = await snapshot();
        const response = await env.request(endpoint.method, endpoint.path(ctx), {
          token: env.tenants.A.users[role].token, body: endpoint.mutating?.(ctx),
        });
        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: "Permessi insufficienti." });
        expect(await snapshot()).toEqual(before);
      },
    );

    it.each(endpoint.allowed)("%s supera il gate dei permessi", async (role) => {
      const response = await env.request(endpoint.method, (endpoint.probePath ?? endpoint.path)(ctx), {
        token: env.tenants.A.users[role].token, body: endpoint.probe?.(ctx),
      });
      expect(response.status).toBe(endpoint.probeStatus);
    });
  });

  describe.each(SESSION_ONLY)("$id (solo sessione valida)", (endpoint) => {
    it("401 senza sessione", async () => {
      const response = await env.request(endpoint.method, endpoint.path, { body: endpoint.body });
      expect(response.status).toBe(401);
    });
    it.each(ROLES)("%s è ammesso", async (role) => {
      // Sessione dedicata: il logout revoca il token usato.
      const user = env.tenants.A.users[role];
      const token = await env.newSession(user.id, env.tenants.A.id);
      const response = await env.request(endpoint.method, endpoint.path, { token, body: endpoint.body });
      expect(response.status).toBe(endpoint.status);
    });
  });

  it("gli endpoint pubblici non richiedono sessione e non rivelano dati", async () => {
    expect((await env.request("GET", "/api/health")).status).toBe(200);
    const accept = await env.request("POST", "/api/invitations/accept", { body: { token: "x", fullName: "n", password: "p" } });
    expect(accept.status).toBe(400);
    const login = await env.request("POST", "/api/auth/login", {
      body: { email: "nessuno@example.test", password: "Password-sbagliata-1", organizationSlug: "tenant-a" },
    });
    expect(login.status).toBe(401);
    const reset = await env.request("POST", "/api/auth/password-reset/request", {
      body: { email: "nessuno@example.test", organizationSlug: "tenant-a" },
    });
    expect(reset.status).toBe(202);
    const complete = await env.request("POST", "/api/auth/password-reset/complete", {
      body: { token: "A".repeat(43), password: "Password-sicura-2026" },
    });
    expect(complete.status).toBe(400);
  });

  it("il ruolo viene letto dal database a ogni richiesta: un declassamento ha effetto immediato", async () => {
    const editor = env.tenants.A.users.editor;
    const token = await env.newSession(editor.id, env.tenants.A.id);
    const probe = () => env.request("POST", "/api/customers", { token, body: { channel: "canale-inesistente" } });
    expect((await probe()).status).toBe(400); // gate superato
    await env.adminPool.query("UPDATE memberships SET role='viewer' WHERE id=$1", [editor.membershipId]);
    try {
      expect((await probe()).status).toBe(403);
    } finally {
      await env.adminPool.query("UPDATE memberships SET role='editor' WHERE id=$1", [editor.membershipId]);
    }
  });
});
