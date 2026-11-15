import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteTenant, planTenantDeletion } from "../src/postgres-tenant-deletion.js";
import { createHttpTestEnvironment, integrationDatabaseUrl, type HttpTestEnvironment } from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });

async function makeTenant(slug: string) {
  const org = (await env.adminPool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1,$1) RETURNING id::text AS id", [slug],
  )).rows[0]!.id;
  await env.adminPool.query(
    "INSERT INTO funnel_stages (organization_id, id, label, position, is_system) VALUES ($1,'visit','Visita',0,TRUE),($1,'lead','Lead',1,TRUE)", [org],
  );
  const user = (await env.adminPool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','U') RETURNING id::text AS id", [`${slug}@example.test`],
  )).rows[0]!.id;
  await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'admin')", [org, user]);
  const customer = (await env.adminPool.query<{ id: string }>(
    "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'c1','Email',NOW()) RETURNING id::text AS id", [org],
  )).rows[0]!.id;
  await env.adminPool.query(
    "INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit',NOW()),($1,$2::bigint,'lead',NOW())", [org, customer],
  );
  await env.adminPool.query("INSERT INTO import_batches (organization_id, fingerprint, file_name, customer_count, row_count) VALUES ($1,'f','f.csv',1,2)", [org]);
  await env.adminPool.query("INSERT INTO audit_logs (organization_id, actor_user_id, action) VALUES ($1,$2,'test.event')", [org, user]);
  await env.newSession(user, org);
  return { org, user };
}
const tenantRows = async (org: string) => (await env.adminPool.query(
  `SELECT (SELECT COUNT(*) FROM customers WHERE organization_id=$1)::int c,
          (SELECT COUNT(*) FROM events WHERE organization_id=$1)::int e,
          (SELECT COUNT(*) FROM sessions WHERE organization_id=$1)::int s,
          (SELECT COUNT(*) FROM audit_logs WHERE organization_id=$1)::int a,
          (SELECT COUNT(*) FROM organizations WHERE id=$1)::int o`, [org],
)).rows[0];

describe.skipIf(!dbUrl)("Cancellazione tenant con protezioni transazionali", () => {
  it("anteprima read-only: conta i dati senza modificarli", async () => {
    const t = await makeTenant("anteprima");
    const before = await tenantRows(t.org);
    const plan = await planTenantDeletion(env.adminPool, "anteprima", env.databaseName);
    expect(plan.counts).toMatchObject({ customers: 1, events: 2, funnel_stages: 2, import_batches: 1, memberships: 1, sessions: 1, audit_logs: 1 });
    expect(plan.orphanUserCandidates).toBe(1);
    expect(await tenantRows(t.org)).toEqual(before);
  });

  it("cancella tenant e utente esclusivo, senza toccare gli altri tenant", async () => {
    const victim = await makeTenant("da-eliminare");
    const beforeA = await tenantRows(env.tenants.A.id);
    const beforeB = await tenantRows(env.tenants.B.id);
    const receipt = await deleteTenant(env.adminPool, "da-eliminare", { expectedDatabase: env.databaseName, confirmSlug: "da-eliminare" });
    expect(receipt).toMatchObject({ organizationSlug: "da-eliminare", deletedUsers: 1, keptUsers: 0 });
    expect(receipt.counts.events).toBe(2);
    expect(await tenantRows(victim.org)).toEqual({ c: 0, e: 0, s: 0, a: 0, o: 0 });
    expect((await env.adminPool.query("SELECT 1 FROM users WHERE id=$1", [victim.user])).rowCount).toBe(0);
    expect(await tenantRows(env.tenants.A.id)).toEqual(beforeA);
    expect(await tenantRows(env.tenants.B.id)).toEqual(beforeB);
  });

  it("attende le scritture concorrenti sul tenant prima di calcolare i conteggi", async () => {
    const t = await makeTenant("concorrenza");
    const writer = await env.adminPool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'concurrent-write','Email',NOW())",
        [t.org],
      );
      const deletion = deleteTenant(env.adminPool, "concorrenza", {
        expectedDatabase: env.databaseName, confirmSlug: "concorrenza",
      });
      // La cancellazione deve attendere il commit che detiene il lock FK sull'organizzazione.
      const finishedEarly = await Promise.race([
        deletion.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(finishedEarly).toBe(false);
      await writer.query("COMMIT");
      const receipt = await deletion;
      expect(receipt.counts.customers).toBe(2);
      expect(await tenantRows(t.org)).toEqual({ c: 0, e: 0, s: 0, a: 0, o: 0 });
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      writer.release();
    }
  });

  it("preserva un utente con membership in un altro tenant", async () => {
    const t = await makeTenant("condiviso");
    await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'viewer')", [env.tenants.B.id, t.user]);
    const receipt = await deleteTenant(env.adminPool, "condiviso", { expectedDatabase: env.databaseName, confirmSlug: "condiviso" });
    expect(receipt.deletedUsers).toBe(0);
    expect(receipt.keptUsers).toBe(1);
    expect((await env.adminPool.query("SELECT 1 FROM users WHERE id=$1", [t.user])).rowCount).toBe(1);
    expect((await env.adminPool.query("SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2", [t.user, env.tenants.B.id])).rowCount).toBe(1);
    await env.adminPool.query("DELETE FROM memberships WHERE user_id=$1", [t.user]);
    await env.adminPool.query("DELETE FROM users WHERE id=$1", [t.user]);
  });

  it("rifiuta slug errato, database errato e tenant inesistente senza scritture", async () => {
    const t = await makeTenant("protetto");
    const before = await tenantRows(t.org);
    await expect(deleteTenant(env.adminPool, "protetto", { expectedDatabase: env.databaseName, confirmSlug: "altro" })).rejects.toThrow(/conferma/);
    await expect(deleteTenant(env.adminPool, "protetto", { expectedDatabase: "database-sbagliato", confirmSlug: "protetto" })).rejects.toThrow(/diverso/);
    await expect(deleteTenant(env.adminPool, "inesistente", { expectedDatabase: env.databaseName, confirmSlug: "inesistente" })).rejects.toThrow(/non trovata/);
    expect(await tenantRows(t.org)).toEqual(before);
  });

  it("il ruolo runtime non può cancellare il tenant", async () => {
    const t = await makeTenant("runtime-negato");
    await expect(deleteTenant(env.runtimePool, "runtime-negato", { expectedDatabase: env.databaseName, confirmSlug: "runtime-negato" })).rejects.toBeTruthy();
    expect((await tenantRows(t.org)).o).toBe(1);
  });

  it("rollback atomico se la cancellazione utente fallisce per un errore non-FK", async () => {
    const t = await makeTenant("atomica");
    await env.adminPool.query(`CREATE OR REPLACE FUNCTION block_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'blocco di prova'; END $$`);
    await env.adminPool.query("CREATE TRIGGER block_users BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION block_user_delete()");
    try {
      const before = await tenantRows(t.org);
      await expect(deleteTenant(env.adminPool, "atomica", { expectedDatabase: env.databaseName, confirmSlug: "atomica" })).rejects.toThrow(/blocco di prova/);
      expect(await tenantRows(t.org)).toEqual(before);
    } finally {
      await env.adminPool.query("DROP TRIGGER block_users ON users");
      await env.adminPool.query("DROP FUNCTION block_user_delete()");
    }
  });
});
