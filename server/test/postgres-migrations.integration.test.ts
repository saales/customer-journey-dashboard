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
const migration005Url = new URL("../migrations/005_runtime_role_grants.sql", import.meta.url);
const migration006Url = new URL("../migrations/006_session_idle_timeout.sql", import.meta.url);
const migration007Url = new URL("../migrations/007_membership_management.sql", import.meta.url);
const migration008Url = new URL("../migrations/008_invitations_tenant_rls.sql", import.meta.url);
const migration009Url = new URL("../migrations/009_api_request_rate_limits.sql", import.meta.url);
const migration010Url = new URL("../migrations/010_audit_log_read_grant.sql", import.meta.url);
const migration011Url = new URL("../migrations/011_password_reset_tokens.sql", import.meta.url);
const migration012Url = new URL("../migrations/012_organization_settings.sql", import.meta.url);

const expectedChecksums = {
  "001_initial_schema.sql": "483595e49acac3dd534ecef096d4735ef9527fbaaa73ef2bff38e904db2dc162",
  "002_session_organization.sql": "3d8b40cddff8f4e704679b164d9dfec1dc42e329b56ee79cd45520ff4a30e188",
};

afterAll(async () => {
  await pool?.end();
});

describe("Migrazioni PostgreSQL recuperate dal checkpoint 12", () => {
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

  it.skipIf(!pool)("applica 001-012 in uno schema isolato e verifica vincoli, backfill, RLS, privilegi e timeout sessione", async () => {
    const schemaName = `migration_it_${randomUUID().replace(/-/g, "")}`;
    const client = await pool!.connect();
    let transactionStarted = false;
    let destroyClient = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}", public`);

      const [sql001, sql002, sql003, sql004, sql005, sql006, sql007, sql008, sql009, sql010, sql011, sql012] = await Promise.all([
        readFile(migration001Url, "utf8"),
        readFile(migration002Url, "utf8"),
        readFile(migration003Url, "utf8"),
        readFile(migration004Url, "utf8"),
        readFile(migration005Url, "utf8"),
        readFile(migration006Url, "utf8"),
        readFile(migration007Url, "utf8"),
        readFile(migration008Url, "utf8"),
        readFile(migration009Url, "utf8"),
        readFile(migration010Url, "utf8"),
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
      await client.query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await client.query("CREATE ROLE percorso_app NOLOGIN");
      await client.query(sql005);
      await client.query(sql006);
      await client.query(sql007);
      await client.query(sql008);
      await client.query(sql009);
      await client.query(sql010);\n      await client.query(sql011);\n      await client.query(sql012);
      const invitationRls = await client.query<{ enabled: boolean }>(
        "SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='invitations'::regclass",
      );
      expect(invitationRls.rows[0]?.enabled).toBe(true);
      const invitationGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "invitations", "INSERT"],
      );
      expect(invitationGrant.rows[0]?.allowed).toBe(true);
      const userInsertGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "users", "INSERT"],
      );
      expect(userInsertGrant.rows[0]?.allowed).toBe(true);
      const passwordHashUpdateGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text, $4::text) AS allowed",
        ["percorso_app", "users", "password_hash", "UPDATE"],
      );
      expect(passwordHashUpdateGrant.rows[0]?.allowed).toBe(true);
      const resetTokenGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "password_reset_tokens", "INSERT"],
      );
      expect(resetTokenGrant.rows[0]?.allowed).toBe(true);
      const organizationNameUpdateGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text, $4::text) AS allowed",
        ["percorso_app", "organizations", "name", "UPDATE"],
      );
      expect(organizationNameUpdateGrant.rows[0]?.allowed).toBe(true);
      const membershipInsertGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "memberships", "INSERT"],
      );
      expect(membershipInsertGrant.rows[0]?.allowed).toBe(true);
      const auditReadGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "audit_logs", "SELECT"],
      );
      expect(auditReadGrant.rows[0]?.allowed).toBe(true);
      const apiRateLimitTable = await client.query<{ exists: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AS exists",
        ["api_request_limits"],
      );
      expect(apiRateLimitTable.rows[0]?.exists).toBe(true);
      const apiRateLimitGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "api_request_limits", "INSERT"],
      );
      expect(apiRateLimitGrant.rows[0]?.allowed).toBe(true);
      const memberManagementGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "memberships", "UPDATE"],
      );
      expect(memberManagementGrant.rows[0]?.allowed).toBe(true);
      const idleTimeoutGrant = await client.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text, $4::text) AS allowed",
        ["percorso_app", "sessions", "last_used_at", "UPDATE"],
      );
      expect(idleTimeoutGrant.rows[0]?.allowed).toBe(true);
      const grants = await client.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, format('%I.%I', current_schema(), $2::text), $3::text) AS allowed",
        ["percorso_app", "customers", "INSERT"],
      );
      expect(grants.rows[0]?.allowed).toBe(true);
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
      expect(Number(policyCount.rows[0]?.count)).toBe(7);

      // Verifica RLS con un ruolo non proprietario: ciascun contesto vede
      // esclusivamente i clienti del tenant selezionato.
      const runtimeRole = `rls_test_${schemaName}`;
      await client.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${runtimeRole}"`);
      await client.query(`GRANT SELECT ON customers, events, funnel_stages, import_batches, audit_logs, invitations TO "${runtimeRole}"`);
      await client.query(`GRANT INSERT, UPDATE, DELETE ON customers, events, funnel_stages, import_batches, audit_logs TO "${runtimeRole}"`);
      const invitationActorId = randomUUID();
      await client.query(
        "INSERT INTO users (id,email,password_hash,full_name,status) VALUES ($1,'inviter@example.test','unused','Inviter','active')",
        [invitationActorId],
      );
      await client.query(
        "INSERT INTO memberships (organization_id,user_id,role,status) VALUES ($1,$2,'admin','active')",
        [organizationId, invitationActorId],
      );
      await client.query(
        "INSERT INTO invitations (organization_id,email,role,token_hash,invited_by,expires_at) VALUES ($1,'invitee@example.test','viewer','known-invite-hash',$2,NOW()+INTERVAL '1 day')",
        [organizationId, invitationActorId],
      );
      await client.query(
        "INSERT INTO funnel_stages (organization_id,id,label,position) VALUES ($1,'visit','Visit A',0),($2,'visit','Visit B',0)",
        [organizationId, secondOrganizationId],
      );
      await client.query(
        `INSERT INTO events (organization_id,customer_id,stage_id,occurred_at)
         SELECT c.organization_id,c.id,'visit',NOW()
         FROM customers c WHERE c.organization_id IN ($1,$2)`,
        [organizationId, secondOrganizationId],
      );
      await client.query(
        "INSERT INTO import_batches (organization_id,fingerprint,file_name,customer_count,row_count) VALUES ($1,'fingerprint-a','a.csv',1,1),($2,'fingerprint-b','b.csv',1,1)",
        [organizationId, secondOrganizationId],
      );
      // audit_logs viene verificata per policy/visibilità senza fabbricare
      // un'azione che potrebbe non rispettare il catalogo applicativo.
      await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      for (const table of ["customers", "events", "funnel_stages", "import_batches", "audit_logs"] as const) {
        const tenantACount = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
        expect(Number(tenantACount.rows[0]?.count), `tenant A / ${table}`).toBe(table === "audit_logs" ? 0 : 1);
      }
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [secondOrganizationId]);
      for (const table of ["customers", "events", "funnel_stages", "import_batches", "audit_logs"] as const) {
        const tenantBCount = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
        expect(Number(tenantBCount.rows[0]?.count), `tenant B / ${table}`).toBe(table === "audit_logs" ? 0 : 1);
      }
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", ["00000000-0000-0000-0000-000000000000"]);
      const unknownTenantCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM customers",
      );
      expect(Number(unknownTenantCount.rows[0]?.count)).toBe(0);

      // La RLS deve isolare ogni tabella tenant-scoped, non solo customers.
      // Il ruolo runtime non proprietario vede solo le righe del contesto attivo.
      for (const table of ["customers", "events", "funnel_stages", "import_batches", "audit_logs"] as const) {
        const isolated = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
        expect(Number(isolated.rows[0]?.count), `RLS su ${table}`).toBe(0);
      }

      // WITH CHECK impedisce anche di scrivere una riga attribuendola a un altro tenant.
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      await client.query("SAVEPOINT cross_tenant_insert");
      await expect(client.query(
        "INSERT INTO customers (id, organization_id, external_id, channel, created_at) VALUES (990001, $1, 'cross-tenant-probe', 'test', NOW())",
        [secondOrganizationId],
      )).rejects.toMatchObject({ code: "42501" });
      // PostgreSQL marca come abortita la transazione dopo l'errore RLS:
      // ripristina il savepoint prima di verificare UPDATE e DELETE.
      await client.query("ROLLBACK TO SAVEPOINT cross_tenant_insert");
      await client.query("RELEASE SAVEPOINT cross_tenant_insert");

      // USING rende invisibili le righe altrui anche per UPDATE e DELETE.
      const foreignUpdate = await client.query(
        "UPDATE customers SET channel = 'tampered' WHERE organization_id = $1",
        [secondOrganizationId],
      );
      const foreignDelete = await client.query(
        "DELETE FROM customers WHERE organization_id = $1",
        [secondOrganizationId],
      );
      expect(foreignUpdate.rowCount).toBe(0);
      expect(foreignDelete.rowCount).toBe(0);
      // Isola il lookup per token dal normale accesso tenant: le policy RLS permissive
      // si combinano in OR, quindi il contesto organizzazione va svuotato in questo test.
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      await client.query("SELECT set_config('app.invitation_token_hash', $1, true)", ["known-invite-hash"]);
      const inviteLookup = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM invitations",
      );
      expect(Number(inviteLookup.rows[0]?.count)).toBe(1);
      await client.query("SELECT set_config('app.invitation_token_hash', $1, true)", ["not-a-valid-hash"]);
      const inviteLookupDenied = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM invitations",
      );
      expect(Number(inviteLookupDenied.rows[0]?.count)).toBe(0);
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
