import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type MemberRole="admin"|"editor"|"analyst"|"viewer";
export type MemberStatus="active"|"suspended";
export interface OrganizationMember { membershipId:string; userId:string; email:string; fullName:string; role:MemberRole; status:MemberStatus; joinedAt:string; }
export class MemberManagementError extends Error { constructor(public readonly status:number,message:string){super(message);} }
export async function listOrganizationMembers(pool:Pick<Pool,"connect">,org:string):Promise<OrganizationMember[]>{
 if(!UUID.test(org))throw new MemberManagementError(400,"Organizzazione non valida.");
 return withTenantTransaction(pool,org,async(client:PoolClient)=>{
  const r=await client.query<OrganizationMember>(`SELECT m.id::text AS "membershipId",u.id::text AS "userId",u.email,u.full_name AS "fullName",m.role,m.status,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "joinedAt"
  FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1::uuid
  ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,LOWER(u.email)`,[org]);
  return r.rows;
 });
}
export async function updateOrganizationMember(pool:Pick<Pool,"connect">,org:string,membershipId:string,actor:string,updates:{role?:unknown;status?:unknown}):Promise<OrganizationMember>{
 if(!UUID.test(org)||!UUID.test(membershipId)||!UUID.test(actor))throw new MemberManagementError(400,"Identificativo non valido.");
 if(!updates||typeof updates!=="object"||Array.isArray(updates))throw new MemberManagementError(400,"Modifiche non valide.");
 const keys=Object.keys(updates);if(!keys.length||keys.some(k=>k!=="role"&&k!=="status"))throw new MemberManagementError(400,"Nessuna modifica valida.");
 let role:MemberRole|undefined,status:MemberStatus|undefined;
 if(Object.hasOwn(updates,"role")){if(!["admin","editor","analyst","viewer"].includes(String(updates.role)))throw new MemberManagementError(400,"Ruolo non valido.");role=updates.role as MemberRole;}
 if(Object.hasOwn(updates,"status")){if(updates.status!=="active"&&updates.status!=="suspended")throw new MemberManagementError(400,"Stato membro non valido.");status=updates.status;}
 return withTenantTransaction(pool,org,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`members:${org}`]);
  const r=await client.query<{userId:string;role:MemberRole;status:MemberStatus}>(`SELECT user_id::text AS "userId",role,status FROM memberships WHERE organization_id=$1::uuid AND id=$2::uuid FOR UPDATE`,[org,membershipId]);
  const old=r.rows[0];if(!old)throw new MemberManagementError(404,"Membro non trovato.");
  if(old.userId===actor)throw new MemberManagementError(409,"Non puoi modificare il tuo stesso accesso.");
  const nextRole=role??old.role,nextStatus=status??old.status;
  if(old.role==="admin"&&old.status==="active"&&(nextRole!=="admin"||nextStatus!=="active")){
   const count=await client.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM memberships WHERE organization_id=$1::uuid AND role='admin' AND status='active'`,[org]);
   if(Number(count.rows[0]?.count??"0")<=1)throw new MemberManagementError(409,"L'organizzazione deve mantenere almeno un amministratore attivo.");
  }
  const changed=await client.query<{userId:string;role:MemberRole;status:MemberStatus;joinedAt:string}>(`UPDATE memberships SET role=$3,status=$4,updated_at=NOW() WHERE organization_id=$1::uuid AND id=$2::uuid RETURNING user_id::text AS "userId",role,status,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "joinedAt"`,[org,membershipId,nextRole,nextStatus]);
  const row=changed.rows[0];if(!row)throw new MemberManagementError(404,"Membro non trovato.");
  const profile=await client.query<{email:string;fullName:string}>('SELECT email,full_name AS "fullName" FROM users WHERE id=$1::uuid',[row.userId]);
  await client.query(`INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details) VALUES($1::uuid,$2::uuid,'membership.updated','membership',$3,jsonb_build_object('previousRole',$4,'role',$5,'previousStatus',$6,'status',$7))`,[org,actor,membershipId,old.role,nextRole,old.status,nextStatus]);
  return {membershipId,userId:row.userId,email:profile.rows[0]?.email??"",fullName:profile.rows[0]?.fullName??"",role:row.role,status:row.status,joinedAt:row.joinedAt};
 });
}
