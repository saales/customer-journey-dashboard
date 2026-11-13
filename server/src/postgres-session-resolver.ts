import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type OrganizationRole = "admin" | "editor" | "analyst" | "viewer";

export interface AuthenticatedSession {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}

interface SessionRow {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}

/** Creates a 256-bit opaque bearer token. Persist only tokenHash, never token. */
export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

/** SHA-256 is used for high-entropy random session tokens, not passwords. */
export function hashSessionToken(token: string): string {
  if (!SESSION_TOKEN_RE.test(token)) {
    throw new Error("Token di sessione non valido.");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Resolves a bearer token to a trusted user/organization/role tuple.
 * The organization is selected only by the server-side session row and then
 * cross-checked against an active membership; it is never accepted as input.
 * Each successful resolution refreshes last_used_at; sessions idle for 30 minutes
 * or past their absolute expires_at are rejected server-side.
 *
 * The Express session middleware calls this resolver after validating the
 * configured session cookie. Cookie parsing, CSRF checks, authentication,
 * session creation/revocation and permission checks remain separate layers.
 */
export async function resolvePostgresSession(
  pool: Pick<Pool, "connect">,
  token: string,
): Promise<AuthenticatedSession | null> {
  if (!SESSION_TOKEN_RE.test(token)) return null;

  const tokenHash = hashSessionToken(token);
  const client: PoolClient = await pool.connect();
  try {
    const result = await client.query<SessionRow>(
      `UPDATE sessions s
       SET last_used_at = NOW()
       FROM users u
       JOIN organizations o
         ON o.status = 'active'
       JOIN memberships m
         ON m.organization_id = o.id
        AND m.user_id = u.id
        AND m.status = 'active'
       WHERE s.token_hash = $1
         AND s.user_id = u.id
         AND s.organization_id = o.id
         AND u.status = 'active'
         AND s.expires_at > NOW()
         AND s.last_used_at > NOW() - INTERVAL '30 minutes'
       RETURNING s.user_id::text AS "userId",
                 s.organization_id::text AS "organizationId",
                 m.role`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}
