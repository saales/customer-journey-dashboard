import type { Pool, PoolClient } from "pg";
import { createSessionToken, hashSessionToken } from "./postgres-session-resolver.js";
import { withTenantTransaction } from "./tenant-transaction.js";

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


export interface PostgresSessionSummary {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

/** Lists only sessions belonging to the authenticated user and active tenant. */
export async function listPostgresAccountSessions(
  pool: Pick<Pool, "connect">, organizationId: string, userId: string, currentToken: string,
): Promise<PostgresSessionSummary[]> {
  const currentHash = hashSessionToken(currentToken);
  return withTenantTransaction(pool, organizationId, async client => {
    const result = await client.query<PostgresSessionSummary>(
      `SELECT id::text AS id,
              created_at AS "createdAt",
              last_used_at AS "lastUsedAt",
              expires_at AS "expiresAt",
              token_hash = $3 AS current
       FROM sessions
       WHERE organization_id = $1::uuid AND user_id = $2::uuid
         AND expires_at > NOW()
         AND last_used_at > NOW() - INTERVAL '30 minutes'
       ORDER BY last_used_at DESC
       LIMIT 50`,
      [organizationId, userId, currentHash],
    );
    return result.rows;
  });
}

/** Revokes a session only within the caller's user and tenant boundary. */
export async function revokePostgresAccountSession(
  pool: Pick<Pool, "connect">, organizationId: string, userId: string, sessionId: string,
): Promise<string | null> {
  if (!UUID_RE.test(sessionId)) return null;
  return withTenantTransaction(pool, organizationId, async client => {
    const result = await client.query<{ tokenHash: string }>(
      `DELETE FROM sessions
       WHERE id = $1::uuid AND organization_id = $2::uuid AND user_id = $3::uuid
       RETURNING token_hash AS "tokenHash"`,
      [sessionId, organizationId, userId],
    );
    if (!result.rows[0]) return null;
    await client.query(
      `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
       VALUES($1::uuid,$2::uuid,'account.session_revoked','session',$3::text,'{}'::jsonb)`,
      [organizationId, userId, sessionId],
    );
    return result.rows[0].tokenHash;
  });
}
