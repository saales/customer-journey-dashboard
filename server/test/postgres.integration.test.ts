import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { verifyPostgresPool } from "../src/postgres-health.js";

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
});
