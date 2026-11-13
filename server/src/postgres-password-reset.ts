import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashPassword } from "./password-hashing.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
function digest(token: string): string {
  if (!TOKEN.test(token)) throw new Error("Token di recupero non valido.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createPostgresPasswordReset(
  pool: Pick<Pool, "connect">, email: string, organizationSlug: string,
): Promise<{ token: string; email: string; fullName: string; organizationId: string } | null> {
  const normalized = email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    const found = await client.query<{ id: string; email: string; fullName: string; organizationId: string }>(
      `SELECT u.id::text AS id, u.email, u.full_name AS "fullName", o.id::text AS "organizationId"
       FROM users u
       JOIN memberships m ON m.user_id=u.id AND m.status='active'
       JOIN organizations o ON o.id=m.organization_id AND o.status='active'
       WHERE LOWER(u.email)=$1 AND o.slug=$2 AND u.status='active'
       LIMIT 1`, [normalized, organizationSlug],
    );
    const user = found.rows[0];
    if (!user) return null;
    const token = randomBytes(32).toString("base64url");
    await client.query(
      "DELETE FROM password_reset_tokens WHERE user_id=$1::uuid OR expires_at<=NOW()", [user.id],
    );
    await client.query(
      `INSERT INTO password_reset_tokens(user_id,organization_id,token_hash,expires_at)
       VALUES($1::uuid,$2::uuid,$3,NOW()+INTERVAL '30 minutes')`,
      [user.id, user.organizationId, digest(token)],
    );
    return { token, email: user.email, fullName: user.fullName, organizationId: user.organizationId };
  } finally {
    client.release();
  }
}

export async function consumePostgresPasswordReset(
  pool: Pick<Pool, "connect">, token: string, password: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("La password deve contenere tra 12 e 1024 caratteri.");
  }
  const tokenHash = digest(token);
  const client: PoolClient = await pool.connect();
  let transaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    const selected = await client.query<{ userId: string; organizationId: string }>(
      `SELECT user_id::text AS "userId", organization_id::text AS "organizationId"
       FROM password_reset_tokens
       WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()
       FOR UPDATE`, [tokenHash],
    );
    const userId = selected.rows[0]?.userId;
    const organizationId = selected.rows[0]?.organizationId;
    if (!userId || !organizationId) {
      await client.query("ROLLBACK");
      transaction = false;
      return false;
    }
    const passwordHash = await hashPassword(password);
    const updated = await client.query(
      `UPDATE users SET password_hash=$2, updated_at=NOW()
       WHERE id=$1::uuid AND status='active'`, [userId, passwordHash],
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      transaction = false;
      return false;
    }
    await client.query(
      "UPDATE password_reset_tokens SET consumed_at=NOW() WHERE token_hash=$1", [tokenHash],
    );
    await client.query("DELETE FROM sessions WHERE user_id=$1::uuid", [userId]);
    await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organizationId]);
    await client.query(
      `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
       VALUES($1::uuid,$2::uuid,'account.password_reset','user',$2::text,'{}'::jsonb)`,
      [organizationId,userId],
    );
    await client.query("COMMIT");
    transaction = false;
    return true;
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    throw error;
  } finally {
    client.release(destroy);
  }
}
