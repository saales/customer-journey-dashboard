import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

const migration001Url = new URL("../migrations/001_initial_schema.sql", import.meta.url);
const migration002Url = new URL("../migrations/002_session_organization.sql", import.meta.url);
const migration003Url = new URL("../migrations/003_saas_tenant_hardening.sql", import.meta.url);
const migration004Url = new URL("../migrations/004_login_attempt_limits.sql", import.meta.url);

const expectedChecksums = {
  "001_initial_schema.sql": "483595e49acac3dd534ecef096d4735ef9527fbaaa73ef2bff38e904db2dc162",
  "002_session_organization.sql": "3d8b40cddff8f4e704679b164d9dfec1dc42e329b56ee79cd45520ff4a30e188",
};

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL migrations recuperate dal checkpoint 12", () => {
  it("mantiene invariati i checksum SHA-256 degli SQL originali", async () => {
    const [sql001, sql002] = await Promise.all([
      readFile(migration001Url, "utf8"),
      readFile(migration002Url, "utf8"),
    ]);

    expect(createHash("sha256").update(sql001).digest("hex"))
      .toBe(expectedChecksums["001_initial_schema.sql"]);
    expect(createHash("sha256").update(sql002).digest("hex"))
      .toBe(expectedChecksums["002_session_organization.sql"]);
  });

  it.skipIf(!pool)("applica 001-003 in uno schema isolato e verifica vincoli, backfill e RLS", async () => {
    const schemaName = `migration_it_${randomUUID().replace(/-/g, "")}`;
    const client = await pool!.connect();
    let transactionStarted = false;
    let destroyClient = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}", public`);

      const [sql001, sql002, sql003, sql004] = await Promise.all([
        readFile(migration001Url, "utf8"),
        readFile(migration002Url, "utf8"),
        readFile(migration003Url, "utf8"),
        readFile(migration004Url, "utf8"),
      ]);

      await client.query(sql001);

      const organizationId = randomUUID();
      await client.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Migration Test', $2)",
        [organizationId, `migration-${schemaName}`],
      );
      const customer = await client.query<{ id: string }>(
        "INSERT INTO customers (organization_id, channel, created_at) VALUES ($1, 'organic', NOW()) RETURNING id::text AS id",
        [organizationId],
      );

      const secondOrganizationId = randomUUID();
      await client.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Second Tenant', $2)",
        [secondOrganizationId, `second-${schemaName}`],
      );
      await client.query(
        "INSERT INTO customers (organization_id, channel, created_at) VALUES ($1, 'paid', NOW())",
        [secondOrganizationId],
      );

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "audit_logs",
        "customers",
        "events",
        "funnel_stages",
        "import_batches",
        "invitations",
        "memberships",
        "organizations",
        "sessions",
        "users",
      ]);

      const eventForeignKeys = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pg_constraint
         WHERE conrelid = 'events'::regclass AND contype = 'f'`,
      );
      expect(Number(eventForeignKeys.rows[0]?.count)).toBe(2);

      const customerRls = await client.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE oid = 'customers'::regclass",
      );
      // La baseline storica non abilita RLS: non va confusa con una policy già attiva.
      expect(customerRls.rows[0]?.relrowsecurity).toBe(false);

      await client.query(sql002);

      const sessionOrganization = await client.query<{ is_nullable: string }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'sessions'
           AND column_name = 'organization_id'`,
      );
      expect(sessionOrganization.rows[0]?.is_nullable).toBe("YES");

      const sessionOrganizationForeignKey = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pg_constraint
         WHERE conrelid = 'sessions'::regclass
           AND confrelid = 'organizations'::regclass
           AND contype = 'f'`,
      );
      expect(Number(sessionOrganizationForeignKey.rows[0]?.count)).toBe(1);

      const sessionIndex = await client.query<{ exists: boolean }>(
        "SELECT to_regclass(format('%I.%I', current_schema(), 'sessions_org_expiry_idx')) IS NOT NULL AS exists",
      );
      expect(sessionIndex.rows[0]?.exists).toBe(true);

      await client.query(sql003);
      await client.query(sql004);
      const loginLimits = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", ["login_attempt_limits"]);
      expect(loginLimits.rows[0]?.exists).toBe(true);

      const customerExternalId = await client.query<{ external_id: string }>(
        "SELECT external_id FROM customers WHERE id = $1",
        [customer.rows[0]?.id],
      );
      expect(customerExternalId.rows[0]?.external_id).toBe(`legacy:${customer.rows[0]?.id}`);

      const hardenedRls = await client.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE oid = 'customers'::regclass",
      );
      expect(hardenedRls.rows[0]?.relrowsecurity).toBe(true);

      const policyCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM pg_policies WHERE schemaname = current_schema()",
      );
      expect(Number(policyCount.rows[0]?.count)).toBe(5);

      // Verifica RLS con un ruolo non proprietario: ciascun contesto vede
      // esclusivamente i clienti del tenant selezionato.
      const runtimeRole = `rls_test_${schemaName}`;
      await client.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${runtimeRole}"`);
      await client.query(`GRANT SELECT ON customers TO "${runtimeRole}"`);
      await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      const tenantACount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM customers",
      );
      expect(Number(tenantACount.rows[0]?.count)).toBe(1);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [secondOrganizationId]);
      const tenantBCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM customers",
      );
      expect(Number(tenantBCount.rows[0]?.count)).toBe(1);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", ["00000000-0000-0000-0000-000000000000"]);
      const unknownTenantCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM customers",
      );
      expect(Number(unknownTenantCount.rows[0]?.count)).toBe(0);
      await client.query("RESET ROLE");

      const membershipFk = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM pg_constraint WHERE conrelid = 'sessions'::regclass AND conname = 'sessions_org_user_membership_fk' AND NOT convalidated",
      );
      expect(Number(membershipFk.rows[0]?.count)).toBe(1);

      await client.query("ROLLBACK");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          destroyClient = true;
        }
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  });
});
