import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { verifyPostgresPool } from "../src/postgres-health.js";
import { withTenantTransaction } from "../src/tenant-transaction.js";
import { inspectPostgresSchema } from "../src/postgres-schema-inspection.js";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL integration smoke test", () => {
  it.skipIf(!pool)("verifica la connessione usando il modulo applicativo", async () => {
    await expect(verifyPostgresPool(pool!)).resolves.toBeUndefined();
  });

  it.skipIf(!pool)("connects and supports transactional DDL/DML", async () => {
    const client = await pool!.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TEMPORARY TABLE pg_smoke_test (id integer PRIMARY KEY, value text NOT NULL) ON COMMIT DROP",
      );
      await client.query(
        "INSERT INTO pg_smoke_test (id, value) VALUES ($1, $2)",
        [1, "journey"],
      );

      const result = await client.query<{ id: number; value: string }>(
        "SELECT id, value FROM pg_smoke_test WHERE id = $1",
        [1],
      );

      expect(result.rows).toEqual([{ id: 1, value: "journey" }]);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  it.skipIf(!pool)("isola il tenant tra transazioni che riutilizzano la stessa connessione", async () => {
    const tenantA = "integration-org-a";
    const tenantB = "integration-org-b";

    const first = await withTenantTransaction(pool!, tenantA, async (client) => {
      const result = await client.query<{ tenant: string; pid: number }>(
        "SELECT current_setting('app.organization_id', true) AS tenant, pg_backend_pid() AS pid",
      );
      return result.rows[0]!;
    });

    const second = await withTenantTransaction(pool!, tenantB, async (client) => {
      const result = await client.query<{ tenant: string; pid: number }>(
        "SELECT current_setting('app.organization_id', true) AS tenant, pg_backend_pid() AS pid",
      );
      return result.rows[0]!;
    });

    expect(first.tenant).toBe(tenantA);
    expect(second.tenant).toBe(tenantB);
    expect(second.pid).toBe(first.pid);

    const after = await pool!.query<{ tenant: string | null }>(
      "SELECT current_setting('app.organization_id', true) AS tenant",
    );
    expect(after.rows[0]?.tenant).not.toBe(tenantA);
    expect(after.rows[0]?.tenant).not.toBe(tenantB);
  });



  it.skipIf(!pool)("ispeziona i cataloghi su PostgreSQL reale senza leggere righe applicative", async () => {
    const schemaName = "inspection_it";

    await pool!.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await pool!.query(`CREATE SCHEMA ${schemaName}`);
    await pool!.query("DROP ROLE IF EXISTS inspection_reader");
    await pool!.query("CREATE ROLE inspection_reader NOLOGIN");

    try {
      await pool!.query(`
        CREATE TABLE ${schemaName}.catalog_probe (
          id integer PRIMARY KEY,
          label text NOT NULL
        )
      `);
      await pool!.query(`
        CREATE TABLE ${schemaName}.private_probe (
          id integer PRIMARY KEY,
          secret_label text NOT NULL
        )
      `);
      await pool!.query(`ALTER TABLE ${schemaName}.catalog_probe ENABLE ROW LEVEL SECURITY`);
      await pool!.query(`
        CREATE POLICY catalog_probe_read ON ${schemaName}.catalog_probe
        FOR SELECT USING (true)
      `);

      await pool!.query(`GRANT USAGE ON SCHEMA ${schemaName} TO inspection_reader`);
      await pool!.query(`GRANT SELECT ON ${schemaName}.catalog_probe TO inspection_reader`);
      const client = await pool!.connect();
      await client.query("SET ROLE inspection_reader");
      const report = await inspectPostgresSchema(client);

      const table = report.tables.find(
        (row) => row.schema === schemaName && row.table === "catalog_probe",
      );
      expect(table?.table_owner).toBeTruthy();
      expect(table?.row_level_security_enabled).toBe(true);
      expect(table?.row_level_security_forced).toBe(false);
      expect(
        report.columns.some(
          (row) => row.schema === schemaName && row.table === "catalog_probe" && row.column_name === "label",
        ),
      ).toBe(true);
      // information_schema.columns hides columns on which the current role has no privilege.
      expect(
        report.columns.some(
          (row) => row.schema === schemaName && row.table === "private_probe",
        ),
      ).toBe(false);
      // Do not disclose table names or structural metadata without SELECT privilege.
      expect(report.tables.some((row) => row.schema === schemaName && row.table === "private_probe")).toBe(false);
      expect(report.constraints.some((row) => row.schema === schemaName && row.table === "private_probe")).toBe(false);
      expect(report.indexes.some((row) => row.schema === schemaName && row.table === "private_probe")).toBe(false);
      expect(report.rowLevelSecurityPolicies.some((row) => row.schema === schemaName && row.table === "private_probe")).toBe(false);
      expect(
        report.constraints.some(
          (row) => row.schema === schemaName && row.table === "catalog_probe" && row.type === "p",
        ),
      ).toBe(true);
      expect(
        report.indexes.some(
          (row) => row.schema === schemaName && row.table === "catalog_probe",
        ),
      ).toBe(true);
      expect(
        report.rowLevelSecurityPolicies.some(
          (row) => row.schema === schemaName && row.table === "catalog_probe" && row.name === "catalog_probe_read",
        ),
      ).toBe(true);
      expect(report.safety).toContain("READ ONLY");
      expect(report.currentRoleCapabilities?.role).toBe("inspection_reader");
      expect(report.currentRoleCapabilities?.is_superuser).toBe(false);
      expect(report.currentRoleCapabilities?.bypasses_rls).toBe(false);
      expect(
        report.tables.every((row) => typeof row.schema !== "string" || !row.schema.startsWith("pg_")),
      ).toBe(true);
    } finally {
      await pool!.query("RESET ROLE");
      await pool!.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await pool!.query("DROP ROLE IF EXISTS inspection_reader");
    }
  });

  it.skipIf(!pool)("ripristina il contesto tenant dopo ROLLBACK prima di riutilizzare la connessione", async () => {
    const tenantA = "integration-org-rollback-a";
    const tenantB = "integration-org-rollback-b";
    const failure = new Error("rollback integration sentinel");
    let firstBackendPid: number | undefined;

    const first = await withTenantTransaction(pool!, tenantA, async (client) => {
      const result = await client.query<{ tenant: string; pid: number }>(
        "SELECT current_setting('app.organization_id', true) AS tenant, pg_backend_pid() AS pid",
      );
      expect(result.rows[0]?.tenant).toBe(tenantA);
      firstBackendPid = result.rows[0]?.pid;
      throw failure;
    }).catch((error: unknown) => {
      expect(error).toBe(failure);
      return null;
    });

    expect(first).toBeNull();

    const second = await withTenantTransaction(pool!, tenantB, async (client) => {
      const result = await client.query<{ tenant: string; pid: number }>(
        "SELECT current_setting('app.organization_id', true) AS tenant, pg_backend_pid() AS pid",
      );
      return result.rows[0]!;
    });

    expect(second.tenant).toBe(tenantB);
    expect(second.pid).toBe(firstBackendPid);
  });

});
