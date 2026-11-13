import type { Pool, PoolClient } from "pg";
import { hashPassword, verifyPassword } from "./password-hashing.js";
import { withTenantTransaction } from "./tenant-transaction.js";

export interface PostgresAccountProfile {
  userId: string;
  email: string;
  fullName: string;
  role: "admin" | "editor" | "analyst" | "viewer";
}

export class PostgresAccountError extends Error {
  constructor(public readonly status: 400 | 401 | 404, message: string) { super(message); }
}

export async function getPostgresAccountProfile(
  pool: Pick<Pool, "connect">, organizationId: string, userId: string,
): Promise<PostgresAccountProfile> {
  return withTenantTransaction(pool, organizationId, async client => {
    const result = await client.query<PostgresAccountProfile>(
      `SELECT u.id::text AS "userId",u.email,u.full_name AS "fullName",m.role
       FROM users u JOIN memberships m ON m.user_id=u.id
       WHERE u.id=$1::uuid AND m.organization_id=$2::uuid
         AND u.status='active' AND m.status='active' LIMIT 1`,
      [userId,organizationId],
    );
    const profile = result.rows[0];
    if (!profile) throw new PostgresAccountError(404,"Profilo non trovato.");
    return profile;
  });
}

export async function updatePostgresAccountName(
  pool: Pick<Pool, "connect">, organizationId: string, userId: string, input: unknown,
): Promise<PostgresAccountProfile> {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 150) {
    throw new PostgresAccountError(400,"Il nome deve contenere da 1 a 150 caratteri.");
  }
  return withTenantTransaction(pool,organizationId,async client=>{
    const membership=await client.query(
      "SELECT 1 FROM memberships WHERE organization_id=$1::uuid AND user_id=$2::uuid AND status='active' FOR SHARE",
      [organizationId,userId],
    );
    if(!membership.rowCount)throw new PostgresAccountError(404,"Profilo non trovato.");
    const result=await client.query(
      `UPDATE users SET full_name=$2,updated_at=NOW()
       WHERE id=$1::uuid AND status='active'`,
      [userId,input.trim()],
    );
    if(result.rowCount!==1)throw new PostgresAccountError(404,"Profilo non trovato.");
    await client.query(
      `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
       VALUES($1::uuid,$2::uuid,'account.profile_updated','user',$2::text,jsonb_build_object('fullName',$3::text))`,
      [organizationId,userId,input.trim()],
    );
    const profile=await client.query<PostgresAccountProfile>(
      `SELECT u.id::text AS "userId",u.email,u.full_name AS "fullName",m.role
       FROM users u JOIN memberships m ON m.user_id=u.id
       WHERE u.id=$1::uuid AND m.organization_id=$2::uuid AND m.status='active' LIMIT 1`,
      [userId,organizationId],
    );
    const row=profile.rows[0];
    if(!row)throw new PostgresAccountError(404,"Profilo non trovato.");
    return row;
  });
}

/** A successful password change revokes all sessions, including the current one. */
export async function changePostgresAccountPassword(
  pool: Pick<Pool, "connect">, organizationId: string, userId: string,
  currentPassword: unknown, newPassword: unknown,
): Promise<void> {
  if (typeof currentPassword !== "string" || currentPassword.length < 1 || currentPassword.length > 1024 ||
      typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 1024) {
    throw new PostgresAccountError(400,"Inserire la password attuale e una nuova password di almeno 12 caratteri.");
  }
  await withTenantTransaction(pool,organizationId,async client=>{
    const membership=await client.query(
      "SELECT 1 FROM memberships WHERE organization_id=$1::uuid AND user_id=$2::uuid AND status='active' FOR SHARE",
      [organizationId,userId],
    );
    if(!membership.rowCount)throw new PostgresAccountError(404,"Profilo non trovato.");
    const credential=await client.query<{passwordHash:string}>(
      "SELECT password_hash AS \"passwordHash\" FROM users WHERE id=$1::uuid AND status='active' FOR UPDATE",
      [userId],
    );
    const passwordHash=credential.rows[0]?.passwordHash;
    if(!passwordHash||!(await verifyPassword(currentPassword,passwordHash))){
      throw new PostgresAccountError(401,"La password attuale non è corretta.");
    }
    const nextHash=await hashPassword(newPassword);
    const updated=await client.query(
      "UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1::uuid AND status='active'",
      [userId,nextHash],
    );
    if(updated.rowCount!==1)throw new PostgresAccountError(404,"Profilo non trovato.");
    await client.query("DELETE FROM sessions WHERE user_id=$1::uuid",[userId]);
    await client.query(
      `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
       VALUES($1::uuid,$2::uuid,'account.password_changed','user',$2::text,'{}'::jsonb)`,
      [organizationId,userId],
    );
  });
}
