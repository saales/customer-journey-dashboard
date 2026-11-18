import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteTenant, planTenantDeletion } from "../src/postgres-tenant-deletion.js";
import { createHttpTestEnvironment, integrationDatabaseUrl, type HttpTestEnvironment } from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });

async function makeTenant(slug: string) {
  const org = (await env.adminPool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1,$1) RETURNING id::text AS id", [slug])).rows[0]!.id;
  await env.adminPool.query("INSERT INTO funnel_stages (organization_id, id, label, position, is_system) VALUES ($1,'visit','Visita',0,TRUE),($1,'lead','Lead',1,TRUE)", [org]);
  const user = (await env.adminPool.query<{ id: string }>("INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','U') RETURNING id::text AS id", [`${slug}@example.test`])).rows[0]!.id;
  await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'admin')", [org, user]);
  const customer = (await env.adminPool.query<{ id: string }>("INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'c1','Email',NOW()) RETURNING id::text AS id", [org])).rows[0]!.id;
  await env.adminPool.query("INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit',NOW()),($1,$2::bigint,'lead',NOW())", [org, customer]);
  await env.adminPool.query("INSERT INTO import_batches (organization_id, fingerprint, file_name, customer_count, row_count) VALUES ($1,'f','f.csv',1,2)", [org]);
  await env.adminPool.query("INSERT INTO audit_logs (organization_id, actor_user_id, action) VALUES ($1,$2,'test.event')", [org, user]);
  await env.newSession(user, org);
  return { org, user };
}
const tenantRows = async (org: string) => (await env.adminPool.query(
  `SELECT (SELECT COUNT(*) FROM customers WHERE organization_id=$1)::int c, (SELECT COUNT(*) FROM events WHERE organization_id=$1)::int e,
          (SELECT COUNT(*) FROM sessions WHERE organization_id=$1)::int s, (SELECT COUNT(*) FROM audit_logs WHERE organization_id=$1)::int a,
          (SELECT COUNT(*) FROM organizations WHERE id=$1)::int o`, [org])).rows[0];

describe.skipIf(!dbUrl)("Cancellazione definitiva di un tenant", () => {
  it("l'anteprima non scrive nulla e riporta i conteggi", async () => {
    const t = await makeTenant("anteprima");
    const before = await tenantRows(t.org);
    const plan = await planTenantDeletion(env.adminPool, "anteprima", env.databaseName);
    expect(plan.counts).toMatchObject({ customers: 1, events: 2, funnel_stages: 2, import_batches: 1, memberships: 1, sessions: 1, audit_logs: 1 });
    expect(plan.orphanUserCandidates).toBe(1);
    expect(await tenantRows(t.org)).toEqual(before);
  });

  it("elimina il tenant con eventi (aggira il RESTRICT), i suoi utenti esclusivi e lascia intatto l'altro tenant", async () => {
    const victim = await makeTenant("da-eliminare");
    const before = {
      A: await tenantRows(env.tenants.A.id), B: await tenantRows(env.tenants.B.id),
      users: (await env.adminPool.query("SELECT COUNT(*)::int n FROM users WHERE email LIKE '%.a@%' OR email LIKE '%.b@%'")).rows[0].n,
    };
    const receipt = await deleteTenant(env.adminPool, "da-eliminare", { expectedDatabase: env.databaseName, confirmSlug: "da-eliminare" });
    expect(receipt).toMatchObject({ organizationSlug: "da-eliminare", deletedUsers: 1, keptUsers: 0 });
    expect(receipt.counts.events).toBe(2);
    expect(await tenantRows(victim.org)).toEqual({ c: 0, e: 0, s: 0, a: 0, o: 0 });
    expect((await env.adminPool.query("SELECT 1 FROM users WHERE id=$1", [victim.user])).rowCount).toBe(0);
    expect(await tenantRows(env.tenants.A.id)).toEqual(before.A);
    expect(await tenantRows(env.tenants.B.id)).toEqual(before.B);
    expect((await env.adminPool.query("SELECT COUNT(*)::int n FROM users WHERE email LIKE '%.a@%' OR email LIKE '%.b@%'")).rows[0].n).toBe(before.users);
  });

  it("un utente presente anche in un altro tenant NON viene eliminato", async () => {
    const t = await makeTenant("condiviso");
    await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'viewer')", [env.tenants.B.id, t.user]);
    const receipt = await deleteTenant(env.adminPool, "condiviso", { expectedDatabase: env.databaseName, confirmSlug: "condiviso" });
    expect(receipt.deletedUsers).toBe(0);
    expect((await env.adminPool.query("SELECT 1 FROM users WHERE id=$1", [t.user])).rowCount).toBe(1);
    expect((await env.adminPool.query("SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2", [t.user, env.tenants.B.id])).rowCount).toBe(1);
    await env.adminPool.query("DELETE FROM memberships WHERE user_id=$1", [t.user]);
    await env.adminPool.query("DELETE FROM users WHERE id=$1", [t.user]);
  });

  it("rifiuta: conferma slug errata, database diverso da quello confermato, slug inesistente — senza scrivere", async () => {
    const t = await makeTenant("protetto");
    const before = await tenantRows(t.org);
    await expect(deleteTenant(env.adminPool, "protetto", { expectedDatabase: env.databaseName, confirmSlug: "altro" })).rejects.toThrow(/conferma/);
    await expect(deleteTenant(env.adminPool, "protetto", { expectedDatabase: "produzione", confirmSlug: "protetto" })).rejects.toThrow(/diverso/);
    await expect(deleteTenant(env.adminPool, "inesistente", { expectedDatabase: env.databaseName, confirmSlug: "inesistente" })).rejects.toThrow(/non trovata/);
    expect(await tenantRows(t.org)).toEqual(before);
  });

  it("il ruolo runtime HTTP NON può cancellare organizzazioni né eventi (solo il proprietario può)", async () => {
    const t = await makeTenant("runtime-negato");
    await expect(deleteTenant(env.runtimePool, "runtime-negato", { expectedDatabase: env.databaseName, confirmSlug: "runtime-negato" })).rejects.toBeTruthy();
    expect((await tenantRows(t.org)).o).toBe(1);
  });

  it("è atomica: se la cancellazione di un utente fallisce per un motivo diverso da un riferimento, nulla viene cancellato", async () => {
    const t = await makeTenant("atomica");
    await env.adminPool.query(`CREATE OR REPLACE FUNCTION block_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'blocco di prova'; END $$`);
    await env.adminPool.query("CREATE TRIGGER block_users BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION block_user_delete()");
    try {
      const before = await tenantRows(t.org);
      await expect(deleteTenant(env.adminPool, "atomica", { expectedDatabase: env.databaseName, confirmSlug: "atomica" })).rejects.toThrow(/blocco di prova/);
      expect(await tenantRows(t.org)).toEqual(before); // eventi e organizzazione ancora presenti
    } finally {
      await env.adminPool.query("DROP TRIGGER block_users ON users");
    }
  });
});
