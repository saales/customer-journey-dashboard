import type { Pool } from "pg";

export async function cleanupPostgresApiRequestLimits(
  pool: Pick<Pool, "query">,
  retentionDays = 7,
  batchSize = 1000,
): Promise<{ deleted: number; retentionDays: number }> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw new Error("La retention deve essere compresa tra 1 e 90 giorni.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
    throw new Error("La dimensione del batch deve essere compresa tra 1 e 10000.");
  }
  const result = await pool.query(
    `WITH stale AS (
       SELECT key_hash
       FROM api_request_limits
       WHERE updated_at < NOW() - ($1::integer * INTERVAL '1 day')
       ORDER BY updated_at
       LIMIT $2::integer
     )
     DELETE FROM api_request_limits AS limits
     USING stale
     WHERE limits.key_hash = stale.key_hash
     RETURNING limits.key_hash`,
    [retentionDays, batchSize],
  );
  return { deleted: result.rowCount ?? result.rows.length, retentionDays };
}
