import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHttpTestEnvironment, integrationDatabaseUrl, ROLES, type HttpTestEnvironment,
} from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Export JSON organizzazione: permessi, contenuto, audit e limiti", () => {
  const token = (role: typeof ROLES[number]) => env.tenants.A.users[role].token;

  it.each(ROLES)("ruolo %s: solo admin/editor/analyst possono esportare", async (role) => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token(role) });
    expect(response.status).toBe(role === "viewer" ? 403 : 200);
  });

  it("senza sessione risponde 401", async () => {
    expect((await env.request("GET", "/api/export/organization.json")).status).toBe(401);
  });

  it("restituisce JSON scaricabile senza cache e con schemaVersion stabile", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      organization: { slug: "tenant-a" },
      funnelStages: expect.any(Array),
      customers: expect.any(Array),
      importBatches: expect.any(Array),
    });
  });

  it("non include dati del tenant B né credenziali, token o sessioni", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("tenant-b");
    expect(response.text).not.toContain("only-b-2");
    expect(response.text).not.toContain("password_hash");
    expect(response.text).not.toContain("token_hash");
    expect(response.text).not.toContain("session_token");
    expect(response.text).not.toContain(env.tenants.B.id);
  });

  it("ogni export riuscito produce una sola voce audit nel tenant A", async () => {
    const beforeA = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    const beforeB = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.B.id]);
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    const afterA = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    const afterB = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.B.id]);
    expect(afterA.rows[0]!.n).toBe(beforeA.rows[0]!.n + 1);
    expect(afterB.rows).toEqual(beforeB.rows);
  });

  it("un export negato non crea una voce audit", async () => {
    const before = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    const response = await env.request("GET", "/api/export/organization.json", { token: token("viewer") });
    expect(response.status).toBe(403);
    const after = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    expect(after.rows).toEqual(before.rows);
  });

  it("gli eventi nel JSON sono ordinati cronologicamente per cliente", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    const body = response.body as { customers: { events: { occurredAt: string }[] }[] };
    for (const customer of body.customers) {
      const dates = customer.events.map(event => event.occurredAt);
      expect(dates).toEqual([...dates].sort());
    }
  });

  it("l'export non modifica il numero di clienti o eventi", async () => {
    const before = await env.adminPool.query(
      "SELECT (SELECT COUNT(*)::int FROM customers WHERE organization_id=$1) AS customers, (SELECT COUNT(*)::int FROM events WHERE organization_id=$1) AS events",
      [env.tenants.A.id],
    );
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    const after = await env.adminPool.query(
      "SELECT (SELECT COUNT(*)::int FROM customers WHERE organization_id=$1) AS customers, (SELECT COUNT(*)::int FROM events WHERE organization_id=$1) AS events",
      [env.tenants.A.id],
    );
    expect(after.rows).toEqual(before.rows);
  });
});
