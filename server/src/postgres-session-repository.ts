import type { Pool, PoolClient } from "pg";
import { createSessionToken, hashSessionToken } from "./postgres-session-resolver.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedPostgresSession {
  token: string;
  expiresAt: string;
}

/** Inserts a session using a caller-owned transaction. */
export async function createPostgresSessionInTransaction(
  client: PoolClient,
  userId: string,
  organizationId: string,
  ttlMs = DEFAULT_SESSION_TTL_MS,
): Promise<IssuedPostgresSession> {
  if (!UUID_RE.test(userId) || !UUID_RE.test(organizationId)) {
    throw new Error("Identificativo utente o organizzazione non valido.");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_SESSION_TTL_MS) {
    throw new Error("Durata della sessione non valida.");
  }

  const { token, tokenHash } = createSessionToken();
  const result = await client.query<{ expiresAt: string }>(
    `INSERT INTO sessions (user_id, organization_id, token_hash, expires_at)
     SELECT u.id, o.id, $3, NOW() + ($4 * INTERVAL '1 millisecond')
     FROM users u
     JOIN memberships m
       ON m.user_id = u.id
      AND m.organization_id = $2::uuid
      AND m.status = 'active'
     JOIN organizations o
       ON o.id = m.organization_id
      AND o.status = 'active'
     WHERE u.id = $1::uuid
       AND u.status = 'active'
     RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "expiresAt"`,
    [userId, organizationId, tokenHash, ttlMs],
  );
  if (result.rowCount !== 1 || !result.rows[0]) {
    throw new Error("Utente, organizzazione o membership non attivi.");
  }
  return { token, expiresAt: result.rows[0].expiresAt };
}

/** Issues a session for an active user/org/membership; stores only the token hash. */
export async function issuePostgresSession(
  pool: Pick<Pool, "connect">,
  userId: string,
  organizationId: string,
  ttlMs = DEFAULT_SESSION_TTL_MS,
): Promise<IssuedPostgresSession> {
  // Rifiuta input errati prima di acquisire una connessione dal pool.
  if (!UUID_RE.test(userId) || !UUID_RE.test(organizationId)) {
    throw new Error("Identificativo utente o organizzazione non valido.");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_SESSION_TTL_MS) {
    throw new Error("Durata della sessione non valida.");
  }
  const client: PoolClient = await pool.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    const issued = await createPostgresSessionInTransaction(client, userId, organizationId, ttlMs);
    await client.query("COMMIT");
    return issued;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      client.release(true);
      released = true;
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
}

/** Revokes a single opaque token by its hash. */
export async function revokePostgresSession(
  pool: Pick<Pool, "connect">,
  token: string,
): Promise<boolean> {
  const tokenHash = hashSessionToken(token);
  const client = await pool.connect();
  try {
    const result = await client.query(
      "DELETE FROM sessions WHERE token_hash = $1",
      [tokenHash],
    );
    return result.rowCount === 1;
  } finally {
    client.release();
  }
}
