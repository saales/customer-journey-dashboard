import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashPassword, verifyPassword } from "./password-hashing.js";
import { createPostgresSessionInTransaction, type IssuedPostgresSession } from "./postgres-session-repository.js";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES=["admin","editor","analyst","viewer"] as const;
export type InvitationRole=(typeof ROLES)[number];
export type InvitationStatus="pending"|"accepted"|"revoked"|"expired";
export interface OrganizationInvitation {
 id:string;email:string;role:InvitationRole;status:InvitationStatus;
 createdAt:string;expiresAt:string;acceptedAt:string|null;revokedAt:string|null;
}
export class InvitationError extends Error {
 constructor(public readonly status:400|401|404|409,message:string){super(message);}
}
function tokenHash(token:string):string{
 if(!TOKEN.test(token))throw new InvitationError(400,"Codice invito non valido.");
 return createHash("sha256").update(token,"utf8").digest("hex");
}
function assertContext(org:string,user:string):void{
 if(!UUID.test(org)||!UUID.test(user))throw new InvitationError(400,"Contesto organizzazione non valido.");
}
function formatDate(column:string):string{
 return `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

export async function createOrganizationInvitation(
 pool:Pick<Pool,"connect">,org:string,actor:string,input:{email:unknown;role:unknown;expiresInDays?:unknown},
):Promise<{invitation:OrganizationInvitation;token:string}>{
 assertContext(org,actor);
 if(!input||typeof input!=="object"||typeof input.email!=="string"||
    input.email.length>254||!EMAIL.test(input.email.trim().toLowerCase()))
  throw new InvitationError(400,"Email di invito non valida.");
 if(typeof input.role!=="string"||!ROLES.includes(input.role as InvitationRole))
  throw new InvitationError(400,"Ruolo invito non valido.");
 const days=input.expiresInDays===undefined?7:input.expiresInDays;
 if(!Number.isInteger(days)||Number(days)<1||Number(days)>30)
  throw new InvitationError(400,"La durata dell'invito deve essere compresa tra 1 e 30 giorni.");
 const email=input.email.trim().toLowerCase(),role=input.role as InvitationRole;
 const token=randomBytes(32).toString("base64url"),hash=tokenHash(token);
 const invitation=await withTenantTransaction(pool,org,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`invitation:${org}:${email}`]);
  const existingMember=await client.query(
   `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=$1::uuid AND LOWER(u.email)=$2 AND m.status='active' LIMIT 1`,
   [org,email]);
  if(existingMember.rowCount)throw new InvitationError(409,"Questo indirizzo appartiene già a un membro attivo dell'organizzazione.");
  const existingInvite=await client.query(
   `SELECT 1 FROM invitations WHERE organization_id=$1::uuid AND LOWER(email)=$2
    AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1`,
   [org,email]);
  if(existingInvite.rowCount)throw new InvitationError(409,"Esiste già un invito attivo per questo indirizzo.");
  const result=await client.query<OrganizationInvitation>(
   `INSERT INTO invitations(organization_id,email,role,token_hash,invited_by,expires_at)
    VALUES($1::uuid,$2,$3,$4,$5::uuid,NOW()+($6::integer*INTERVAL '1 day'))
    RETURNING id::text AS id,email,role,'pending'::text AS status,
      ${formatDate("created_at")} AS "createdAt",
      ${formatDate("expires_at")} AS "expiresAt",NULL::text AS "acceptedAt",NULL::text AS "revokedAt"`,
   [org,email,role,hash,actor,days]);
  const row=result.rows[0];if(!row)throw new Error("Creazione invito non riuscita.");
  await client.query(
   `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
    VALUES($1::uuid,$2::uuid,'membership.invited','invitation',$3::text,
      jsonb_build_object('email',$4::text,'role',$5::text,'expiresInDays',$6::integer))`,
   [org,actor,row.id,email,role,days]);
  return row;
 });
 return {invitation,token};
}

export async function listOrganizationInvitations(
 pool:Pick<Pool,"connect">,org:string,
):Promise<OrganizationInvitation[]>{
 if(!UUID.test(org))throw new InvitationError(400,"Organizzazione non valida.");
 return withTenantTransaction(pool,org,async client=>{
  const r=await client.query<OrganizationInvitation>(
   `SELECT id::text AS id,email,role,
     CASE WHEN accepted_at IS NOT NULL THEN 'accepted'
          WHEN revoked_at IS NOT NULL THEN 'revoked'
          WHEN expires_at<=NOW() THEN 'expired' ELSE 'pending' END AS status,
     ${formatDate("created_at")} AS "createdAt",
     ${formatDate("expires_at")} AS "expiresAt",
     CASE WHEN accepted_at IS NULL THEN NULL ELSE ${formatDate("accepted_at")} END AS "acceptedAt",
     CASE WHEN revoked_at IS NULL THEN NULL ELSE ${formatDate("revoked_at")} END AS "revokedAt"
    FROM invitations WHERE organization_id=$1::uuid
    ORDER BY created_at DESC LIMIT 100`,[org]);
  return r.rows;
 });
}

export async function revokeOrganizationInvitation(
 pool:Pick<Pool,"connect">,org:string,actor:string,id:string,
):Promise<void>{
 assertContext(org,actor);
 if(!UUID.test(id))throw new InvitationError(400,"Identificativo invito non valido.");
 await withTenantTransaction(pool,org,async client=>{
  const result=await client.query(
   `UPDATE invitations SET revoked_at=NOW()
    WHERE organization_id=$1::uuid AND id=$2::uuid
      AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()`,
   [org,id]);
  if(result.rowCount!==1)throw new InvitationError(404,"Invito non trovato o non più revocabile.");
  await client.query(
   `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
    VALUES($1::uuid,$2::uuid,'membership.invitation_revoked','invitation',$3::text,'{}'::jsonb)`,
   [org,actor,id]);
 });
}

/** Accetta un invito e crea/riattiva la membership, la sessione e l'audit nella stessa transazione. */
export async function acceptOrganizationInvitation(
 pool:Pick<Pool,"connect">,input:{token:unknown;fullName:unknown;password:unknown},
):Promise<{session:IssuedPostgresSession;organizationSlug:string}>{
 if(!input||typeof input!=="object"||typeof input.token!=="string"||
    typeof input.fullName!=="string"||!input.fullName.trim()||input.fullName.trim().length>150||
    typeof input.password!=="string"||input.password.length<12||input.password.length>1024)
  throw new InvitationError(400,"Inserire un nome e una password di almeno 12 caratteri.");
 const hash=tokenHash(input.token);
 const client:PoolClient=await pool.connect();
 let transaction=false,destroy=false;
 try{
  await client.query("BEGIN");transaction=true;
  await client.query("SELECT set_config('app.invitation_token_hash',$1,true)",[hash]);
  const invitation=await client.query<{id:string;organizationId:string;email:string;role:InvitationRole;organizationSlug:string}>(
   `SELECT i.id::text AS id,i.organization_id::text AS "organizationId",i.email,i.role,o.slug AS "organizationSlug"
    FROM invitations i JOIN organizations o ON o.id=i.organization_id
    WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      AND i.expires_at>NOW() AND o.status='active'`,[hash]);
  const invite=invitation.rows[0];
  if(!invite)throw new InvitationError(400,"Invito non valido, scaduto o già utilizzato.");
  await client.query("SELECT set_config('app.current_organization_id',$1,true)",[invite.organizationId]);
  const locked=await client.query(
   `SELECT i.id FROM invitations i JOIN organizations o ON o.id=i.organization_id
    WHERE i.id=$1::uuid AND i.organization_id=$2::uuid
      AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      AND i.expires_at>NOW() AND o.status='active'
    FOR UPDATE OF i`,[invite.id,invite.organizationId]);
  if(!locked.rowCount)throw new InvitationError(400,"Invito non valido, scaduto o già utilizzato.");
  const found=await client.query<{id:string;passwordHash:string;status:string}>(
   `SELECT id::text AS id,password_hash AS "passwordHash",status
    FROM users WHERE LOWER(email)=$1 LIMIT 1 FOR UPDATE`,[invite.email.toLowerCase()]);
  let userId:string;
  if(found.rows[0]){
   const user=found.rows[0];
   if(user.status!=="active"||!(await verifyPassword(input.password,user.passwordHash)))
    throw new InvitationError(401,"Non è stato possibile verificare l'account esistente.");
   userId=user.id;
  }else{
   // Verifica prima il token: non consumare CPU con scrypt per richieste anonime non valide.
   const newPasswordHash=await hashPassword(input.password);
   const created=await client.query<{id:string}>(
    `INSERT INTO users(email,password_hash,full_name,status,email_verified_at)
     VALUES($1,$2,$3,'active',NULL) RETURNING id::text AS id`,
    [invite.email.toLowerCase(),newPasswordHash,input.fullName.trim()]);
   userId=created.rows[0]?.id??"";
   if(!UUID.test(userId))throw new Error("Creazione account non riuscita.");
  }
  const membership=await client.query<{status:string}>(
   "SELECT status FROM memberships WHERE organization_id=$1::uuid AND user_id=$2::uuid FOR UPDATE",
   [invite.organizationId,userId]);
  if(membership.rows[0]?.status==="active")
   throw new InvitationError(409,"L'account appartiene già a questa organizzazione.");
  if(membership.rows[0]){
   await client.query(
    "UPDATE memberships SET role=$3,status='active',updated_at=NOW() WHERE organization_id=$1::uuid AND user_id=$2::uuid",
    [invite.organizationId,userId,invite.role]);
  }else{
   await client.query(
    "INSERT INTO memberships(organization_id,user_id,role,status) VALUES($1::uuid,$2::uuid,$3,'active')",
    [invite.organizationId,userId,invite.role]);
  }
  const acceptedUpdate=await client.query("UPDATE invitations SET accepted_at=NOW() WHERE id=$1::uuid AND organization_id=$2::uuid AND accepted_at IS NULL AND revoked_at IS NULL",[invite.id,invite.organizationId]);
  if(acceptedUpdate.rowCount!==1)throw new InvitationError(400,"Invito non valido, scaduto o già utilizzato.");
  await client.query(
   `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
    VALUES($1::uuid,$2::uuid,'membership.invitation_accepted','invitation',$3::text,
      jsonb_build_object('role',$4::text))`,
   [invite.organizationId,userId,invite.id,invite.role]);
  const session=await createPostgresSessionInTransaction(client,userId,invite.organizationId);
  await client.query("COMMIT");transaction=false;
  return {session,organizationSlug:invite.organizationSlug};
 }catch(error){
  if(transaction){try{await client.query("ROLLBACK");}catch{destroy=true;}}
  if((error as {code?:string})?.code==="23505")throw new InvitationError(409,"L'account o l'appartenenza esistono già.");
  throw error;
 }finally{client.release(destroy);}
}
