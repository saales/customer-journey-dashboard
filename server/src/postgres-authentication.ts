import type { Pool, PoolClient } from "pg";
import { hashPassword, passwordHashNeedsRehash, verifyPassword } from "./password-hashing.js";
import { issuePostgresSession, type IssuedPostgresSession } from "./postgres-session-repository.js";

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

  if (!credential || !(await verifyPassword(password, credential.passwordHash))) {
    return null;
  }

  if (passwordHashNeedsRehash(credential.passwordHash)) {
    // Upgrade old scrypt parameters after a successful login. Compare-and-swap
    // prevents a concurrent password change/reset from being overwritten.
    const upgradedHash = await hashPassword(password);
    const upgradeClient = await pool.connect();
    let passwordStillValid = false;
    try {
      const updated = await upgradeClient.query(
        `UPDATE users
         SET password_hash = $1, updated_at = NOW()
         WHERE id = $2::uuid AND password_hash = $3 AND status = 'active'`,
        [upgradedHash, credential.userId, credential.passwordHash],
      );
      if (updated.rowCount === 1) {
        passwordStillValid = true;
      } else {
        const latest = await upgradeClient.query<{ passwordHash: string }>(
          "SELECT password_hash AS \"passwordHash\" FROM users WHERE id = $1::uuid AND status = 'active'",
          [credential.userId],
        );
        passwordStillValid = Boolean(latest.rows[0] && await verifyPassword(password, latest.rows[0].passwordHash));
      }
    } finally {
      upgradeClient.release();
    }
    if (!passwordStillValid) return null;
  }

  return issuePostgresSession(pool, credential.userId, credential.organizationId);
}
