import type { Pool } from "pg";

export interface LoginAttemptCleanupResult {
  deleted: number;
  retentionDays: number;
}

/** Deletes stale HMAC-only login limiter rows in bounded batches. */
export async function cleanupPostgresLoginAttemptLimits(
  pool: Pick<Pool, "query">,
  retentionDays = 7,
  batchSize = 1000,
): Promise<LoginAttemptCleanupResult> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw new Error("La retention deve essere compresa tra 1 e 90 giorni.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
    throw new Error("La dimensione del batch deve essere compresa tra 1 e 10000.");
  }
  const result = await pool.query(
    `WITH stale AS (
       SELECT key_hash
       FROM login_attempt_limits
       WHERE updated_at < NOW() - ($1::integer * INTERVAL '1 day')
       ORDER BY updated_at
       LIMIT $2::integer
     )
     DELETE FROM login_attempt_limits AS limits
     USING stale
     WHERE limits.key_hash = stale.key_hash
     RETURNING limits.key_hash`,
    [retentionDays, batchSize],
  );
  return { deleted: result.rowCount ?? result.rows.length, retentionDays };
}
