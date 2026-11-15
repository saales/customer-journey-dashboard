import type { Pool, PoolClient } from "pg";
import { verifyPassword } from "./password-hashing.js";
import { issuePostgresSession, type IssuedPostgresSession } from "./postgres-session-repository.js";

// A fixed dummy hash makes unknown-account login attempts pay the same scrypt
// cost as a known account with a wrong password, reducing timing-based enumeration.
const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$nypNbIseP1BxkqS2yNDi9A$_-BiuFn8yIlUwZL_jc5LL-Yo6RMy0cgRi9M3wRBCf_LMT_hQS_QFsSn4VuI1UU1J7TkIkHzpsXjLjDf-lO8WqQ";

/**
 * Authenticates a user against one explicitly selected organization.
 * Unknown users, wrong passwords, inactive accounts and inactive/missing
 * memberships all produce the same null result to avoid account enumeration.
 * Session issuance re-checks active states before persisting the session.
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return null;

  const client: PoolClient = await pool.connect();
  let credential: { userId: string; passwordHash: string; organizationId: string } | undefined;
  try {
    const result = await client.query<{
      userId: string;
      passwordHash: string;
      organizationId: string;
    }>(
      `SELECT u.id::text AS "userId",
              u.password_hash AS "passwordHash",
              o.id::text AS "organizationId"
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

  if (!credential) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }
  if (!(await verifyPassword(password, credential.passwordHash))) return null;

  return issuePostgresSession(pool, credential.userId, credential.organizationId);
}
