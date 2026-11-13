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
 *
 * This resolver is not yet wired to Express. Cookie transport, CSRF policy,
 * login/password verification, session creation/revocation routes and
 * authorization middleware remain separate work.
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
      `SELECT s.user_id::text AS "userId",
              s.organization_id::text AS "organizationId",
              m.role
       FROM sessions s
       JOIN users u
         ON u.id = s.user_id
        AND u.status = 'active'
       JOIN organizations o
         ON o.id = s.organization_id
        AND o.status = 'active'
       JOIN memberships m
         ON m.user_id = s.user_id
        AND m.organization_id = s.organization_id
        AND m.status = 'active'
       WHERE s.token_hash = $1
         AND s.organization_id IS NOT NULL
         AND s.expires_at > NOW()
       LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}
