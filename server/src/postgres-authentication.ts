import type { Pool, PoolClient } from "pg";
import { verifyPassword } from "./password-hashing.js";
import { issuePostgresSession, type IssuedPostgresSession } from "./postgres-session-repository.js";

export const INVALID_CREDENTIALS_MESSAGE = "Credenziali non valide.";

interface CredentialRow {
  userId: string;
  passwordHash: string;
  organizationId: string;
}

/**
 * Authenticates a user against one explicitly selected organization.
 * Returns the same null result for unknown users, wrong passwords, inactive
 * accounts, and missing/inactive memberships to avoid account enumeration.
 * Session issuance re-checks all active states before persisting the session.
 */
export async function authenticatePostgresCredentials(
  pool: Pick<Pool, "connect">,
  email: string,
  password: string,
  organizationSlug: string,
): Promise<IssuedPostgresSession | null> {
  if (
    typeof email !== "string" || email.length > 254 ||
    typeof password !== "string" || password.length < 1 || password.length > 1024 ||
    typeof organizationSlug !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(organizationSlug)
  ) return null;

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)) return null;

  const client: PoolClient = await pool.connect();
  let credential: CredentialRow | undefined;
  try {
    const result = await client.query<CredentialRow>(
      `SELECT u.id::text AS "userId", u.password_hash AS "passwordHash",\n              o.id::text AS "organizationId"
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
       JOIN organizations o ON o.id = m.organization_id AND o.status = 'active'
       WHERE LOWER(u.email) = $1
         AND u.status = 'active'
         AND o.slug = $2
       LIMIT 1`,
      [normalizedEmail, organizationSlug],
    );
    credential = result.rows[0];
  } finally {
    client.release();
  }

  if (!credential || !(await verifyPassword(password, credential.passwordHash))) {
    return null;
  }

  // issuePostgresSession repeats active user/org/membership checks atomically.
  return issuePostgresSession(pool, credential.userId, credential.organizationId);
}

async function getOrganizationId(
  pool: Pick<Pool, "connect">,
  slug: string,
): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM organizations WHERE slug = $1 AND status = 'active' LIMIT 1",
      [slug],
    );
    if (!result.rows[0]) throw new Error(INVALID_CREDENTIALS_MESSAGE);
    return result.rows[0].id;
  } finally {
    client.release();
  }
}
