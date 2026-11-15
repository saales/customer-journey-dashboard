import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHttpTestEnvironment, integrationDatabaseUrl, type HttpTestEnvironment,
} from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Isolamento multi-tenant HTTP e PostgreSQL", () => {
  const a = () => env.tenants.A;
  const b = () => env.tenants.B;
  const adminA = () => a().users.admin.token;
  const adminB = () => b().users.admin.token;

  it("le letture HTTP di A non contengono identificativi esclusivi di B", async () => {
    const [customers, funnel, summary] = await Promise.all([
      env.request("GET", "/api/customers", { token: adminA() }),
      env.request("GET", "/api/funnel-stages", { token: adminA() }),
      env.request("GET", "/api/summary?from=2026-01-01&to=2026-12-31", { token: adminA() }),
    ]);
    expect(customers.status).toBe(200);
    expect(customers.text).not.toContain("only-b-2");
    expect(customers.text).not.toContain(b().id);
    expect(funnel.status).toBe(200);
    expect(funnel.text).not.toContain(b().id);
    expect(summary.status).toBe(200);
    expect(summary.text).not.toContain(b().id);
  });

  it("PUT e DELETE su un cliente noto di B rispondono 404 senza modificare B", async () => {
    const customerId = b().customerIds[0]!;
    const before = await env.adminPool.query(
      "SELECT c.id::text, c.external_id, c.channel, e.id::text AS event_id FROM customers c LEFT JOIN events e ON e.organization_id=c.organization_id AND e.customer_id=c.id WHERE c.organization_id=$1 AND c.id=$2 ORDER BY e.id",
      [b().id, customerId],
    );
    const body = { externalId: "cross-tenant-attempt", channel: "Email", createdAt: "2026-01-10", events: [] };
    const update = await env.request("PUT", `/api/customers/${customerId}`, { token: adminA(), body });
    const remove = await env.request("DELETE", `/api/customers/${customerId}`, { token: adminA() });
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
    const after = await env.adminPool.query(
      "SELECT c.id::text, c.external_id, c.channel, e.id::text AS event_id FROM customers c LEFT JOIN events e ON e.organization_id=c.organization_id AND e.customer_id=c.id WHERE c.organization_id=$1 AND c.id=$2 ORDER BY e.id",
      [b().id, customerId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("un export JSON di A non contiene clienti, fasi o importazioni di B", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: adminA() });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.text).toContain('"slug":"tenant-a"');
    expect(response.text).not.toContain('"slug":"tenant-b"');
    expect(response.text).not.toContain("only-b-2");
    expect(response.text).not.toContain(b().id);
  });

  it("organizationId ostile nel payload di import non può spostare i dati nel tenant B", async () => {
    const beforeA = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM customers WHERE organization_id=$1", [a().id]);
    const beforeB = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM customers WHERE organization_id=$1", [b().id]);
    const response = await env.request("POST", "/api/import", {
      token: adminA(),
      body: {
        fileName: "cross-tenant.csv",
        organizationId: b().id,
        rows: [{ externalId: "hostile-org-id", channel: "Email", createdAt: "2026-11-01", stage: "visit", occurredAt: "2026-11-01", organizationId: b().id }],
      },
    });
    expect(response.status).toBe(201);
    const afterA = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM customers WHERE organization_id=$1", [a().id]);
    const afterB = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM customers WHERE organization_id=$1", [b().id]);
    if (response.status === 201) {
      expect(afterA.rows[0]!.n).toBe(beforeA.rows[0]!.n + 1);
      expect(afterB.rows[0]!.n).toBe(beforeB.rows[0]!.n);
    } else {
      expect(afterA.rows).toEqual(beforeA.rows);
      expect(afterB.rows).toEqual(beforeB.rows);
    }
  });

  it("il ruolo runtime senza contesto tenant non legge righe e non può modificare dati di B", async () => {
    const visible = await env.runtimePool.query("SELECT id FROM customers");
    expect(visible.rows).toEqual([]);
    const changed = await env.runtimePool.query(
      "UPDATE customers SET channel='Social' WHERE organization_id=$1 RETURNING id",
      [b().id],
    );
    expect(changed.rows).toEqual([]);
    const persisted = await env.adminPool.query("SELECT channel FROM customers WHERE organization_id=$1 AND id=$2", [b().id, b().customerIds[0]]);
    expect(persisted.rows[0]!.channel).toBe("Email");
  });

  it("un viewer non può esportare né leggere l'audit", async () => {
    expect((await env.request("GET", "/api/export/organization.json", { token: a().users.viewer.token })).status).toBe(403);
    expect((await env.request("GET", "/api/audit", { token: a().users.viewer.token })).status).toBe(403);
  });

  it("un utente anonimo non può accedere alle risorse tenant", async () => {
    expect((await env.request("GET", "/api/customers")).status).toBe(401);
    expect((await env.request("GET", "/api/export/organization.json")).status).toBe(401);
  });

  it("l'elenco membri di A non espone utenti appartenenti solo a B", async () => {
    const response = await env.request<Array<{ userId: string; email: string }>>(
      "GET", "/api/members", { token: a().users.admin.token },
    );
    expect(response.status).toBe(200);
    expect(response.body.map(member => member.userId).sort()).toEqual(
      Object.values(a().users).map(user => user.id).sort(),
    );
    expect(response.text).not.toMatch(/\\.b@example\\.test/);
  });

  it("PATCH da A verso membership o userId di B restituisce 404 e lascia B invariato", async () => {
    const before = await env.adminPool.query(
      "SELECT id::text, user_id::text, role, status FROM memberships WHERE organization_id=$1 ORDER BY id",
      [b().id],
    );
    const targets = [b().users.admin.membershipId, b().users.viewer.membershipId, b().users.viewer.id];
    for (const target of targets) {
      const response = await env.request("PATCH", `/api/members/${target}`, {
        token: a().users.admin.token, body: { role: "viewer", status: "suspended" },
      });
      expect(response.status).toBe(404);
    }
    const after = await env.adminPool.query(
      "SELECT id::text, user_id::text, role, status FROM memberships WHERE organization_id=$1 ORDER BY id",
      [b().id],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("un amministratore non può ridurre il proprio ruolo", async () => {
    const response = await env.request("PATCH", `/api/members/${a().users.admin.membershipId}`, {
      token: a().users.admin.token, body: { role: "viewer" },
    });
    expect(response.status).toBe(409);
    const member = await env.adminPool.query(
      "SELECT role, status FROM memberships WHERE id=$1",
      [a().users.admin.membershipId],
    );
    expect(member.rows[0]).toEqual({ role: "admin", status: "active" });
  });

  it("il ruolo runtime non possiede privilegi owner, superuser o BYPASSRLS", async () => {
    const role = await env.runtimePool.query(
      "SELECT rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user",
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false,
    });
    const owned = await env.runtimePool.query(
      "SELECT relname FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND relkind='r'",
    );
    expect(owned.rows).toEqual([]);
  });

  it.each(["customers", "events", "funnel_stages", "import_batches", "audit_logs", "invitations"])(
    "senza contesto tenant RLS nasconde ogni riga da %s",
    async (table) => {
      const result = await env.runtimePool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      expect(result.rows[0]!.n).toBe(0);
    },
  );

  it("la stessa identità utente può avere sessioni distinte e vede il tenant della sessione", async () => {
    const user = a().users.admin;
    const secondMembership = await env.adminPool.query(
      "INSERT INTO memberships (organization_id,user_id,role,status) VALUES ($1,$2,'viewer','active') RETURNING id",
      [b().id, user.id],
    );
    const tokenB = await env.newSession(user.id, b().id);
    try {
      const responseA = await env.request("GET", "/api/customers", { token: user.token });
      const responseB = await env.request("GET", "/api/customers", { token: tokenB });
      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);
      // La route restituisce gli ID numerici, non externalId: confrontiamo gli ID
      // dei fixture creati per ciascun tenant.
      expect(responseA.text).toContain(`"id":"${a().customerIds[1]}"`);
      expect(responseA.text).not.toContain(`"id":"${b().customerIds[1]}"`);
      expect(responseB.text).toContain(`"id":"${b().customerIds[1]}"`);
      expect(responseB.text).not.toContain(`"id":"${a().customerIds[1]}"`);
    } finally {
      await env.adminPool.query("DELETE FROM memberships WHERE id=$1", [secondMembership.rows[0]!.id]);
    }
  });
});
