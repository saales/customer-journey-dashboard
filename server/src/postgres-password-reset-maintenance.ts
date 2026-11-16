import type { Pool } from "pg";

export interface PasswordResetTokenCleanupResult {
  deleted: number;
  batchSize: number;
}

/** Rimuove token di recupero già consumati o scaduti, in batch limitati. */
export async function cleanupPostgresPasswordResetTokens(
  pool: Pick<Pool, "query">,
  batchSize = 1000,
): Promise<PasswordResetTokenCleanupResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
    throw new Error("La dimensione del batch deve essere compresa tra 1 e 10000.");
  }
  const result = await pool.query(
    `WITH stale AS (
       SELECT id FROM password_reset_tokens
       WHERE (consumed_at IS NOT NULL OR expires_at <= NOW())
         AND created_at < NOW() - INTERVAL '1 day'
       ORDER BY created_at
       LIMIT $1::integer
     )
     DELETE FROM password_reset_tokens AS tokens
     USING stale
     WHERE tokens.id = stale.id
     RETURNING tokens.id`,
    [batchSize],
  );
  return { deleted: result.rowCount ?? result.rows.length, batchSize };
}
