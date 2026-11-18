import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { cleanupPostgresLoginAttemptLimits } from "../src/postgres-login-attempt-maintenance.js";

const cs = process.env.DATABASE_URL;
const pool = cs ? new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 5000 }) : null;

beforeEach(async () => {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query(`CREATE TEMP TABLE IF NOT EXISTS login_attempt_limits(
      key_hash CHAR(64) PRIMARY KEY,window_started_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ) ON COMMIT PRESERVE ROWS`);
    await client.query("TRUNCATE login_attempt_limits");
    await client.query(
      `INSERT INTO login_attempt_limits(key_hash,window_started_at,attempts,updated_at)
       VALUES($1,NOW()-INTERVAL '8 days',1,NOW()-INTERVAL '8 days'),
             ($2,NOW()-INTERVAL '1 day',2,NOW()-INTERVAL '1 day')`,
      ["a".repeat(64), "b".repeat(64)],
    );
  } finally { client.release(); }
});
afterAll(async () => { await pool?.end(); });

describe("Pulizia tentativi login PostgreSQL", () => {
  it.skipIf(!pool)("rimuove solo le righe oltre la retention e rispetta il batch", async () => {
    const result = await cleanupPostgresLoginAttemptLimits(pool!, 7, 1);
    expect(result).toEqual({ deleted: 1, retentionDays: 7 });
    const rows = await pool!.query<{ key_hash: string }>("SELECT key_hash FROM login_attempt_limits");
    expect(rows.rows.map(row => row.key_hash.trim())).toEqual(["b".repeat(64)]);
  });
});
