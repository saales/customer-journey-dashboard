import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { verifyPostgresPool } from "../src/postgres-health.js";
import { withTenantTransaction } from "../src/tenant-transaction.js";

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
