import {afterAll,beforeEach,describe,expect,it} from "vitest";
import {Pool} from "pg";
import {createHash} from "node:crypto";
import {createOrganizationInvitation,acceptOrganizationInvitation,listOrganizationInvitations,revokeOrganizationInvitation} from "../src/postgres-invitations-repository.js";
import {resolvePostgresSession} from "../src/postgres-session-resolver.js";

const cs=process.env.DATABASE_URL;
const pool=cs?new Pool({connectionString:cs,max:1,connectionTimeoutMillis:5000}):null;
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",admin="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(async()=>{
 if(!pool)return;
 const c=await pool.connect();
 try{
  await c.query(`CREATE TEMP TABLE IF NOT EXISTS organizations(id UUID PRIMARY KEY,slug TEXT NOT NULL,status TEXT NOT NULL) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE IF NOT EXISTS users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,full_name TEXT NOT NULL,status TEXT NOT NULL,email_verified_at TIMESTAMPTZ) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE IF NOT EXISTS memberships(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,user_id UUID NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(organization_id,user_id)) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE IF NOT EXISTS invitations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,invited_by UUID NOT NULL,expires_at TIMESTAMPTZ NOT NULL,accepted_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW()) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE IF NOT EXISTS sessions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL,organization_id UUID NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW()) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE IF NOT EXISTS audit_logs(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id UUID NOT NULL,actor_user_id UUID NOT NULL,action TEXT NOT NULL,resource_type TEXT,resource_id TEXT,details JSONB NOT NULL DEFAULT '{}'::jsonb) ON COMMIT PRESERVE ROWS`);
  await c.query("TRUNCATE audit_logs,invitations,sessions,memberships,users,organizations RESTART IDENTITY CASCADE");
  await c.query("INSERT INTO organizations(id,slug,status) VALUES($1,'azienda-test','active')",[org]);
  await c.query("INSERT INTO users(id,email,password_hash,full_name,status) VALUES($1,'admin@example.test','unused-hash','Admin','active')",[admin]);
  await c.query("INSERT INTO memberships(organization_id,user_id,role,status) VALUES($1,$2,'admin','active')",[org,admin]);
 }finally{c.release();}
});
afterAll(async()=>{await pool?.end();});
describe("Inviti PostgreSQL — integrazione",()=>{
 it.skipIf(!pool)("crea, accetta e consuma un invito creando account, membership, sessione e audit",async()=>{
  const created=await createOrganizationInvitation(pool!,org,admin,{email:"new@example.test",role:"editor"});
  expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const c=await pool!.connect();
  try{
   const stored=await c.query<{token_hash:string}>("SELECT token_hash FROM invitations WHERE id=$1",[created.invitation.id]);
   expect(stored.rows[0]?.token_hash).toBe(createHash("sha256").update(created.token).digest("hex"));
   expect(stored.rows[0]?.token_hash).not.toBe(created.token);
  }finally{c.release();}
  expect((await listOrganizationInvitations(pool!,org))[0]?.status).toBe("pending");
  const accepted=await acceptOrganizationInvitation(pool!,{token:created.token,fullName:"Nuovo membro",password:"UnaPasswordSicura-2026"});
  expect(accepted.organizationSlug).toBe("azienda-test");
  await expect(resolvePostgresSession(pool!,accepted.session.token)).resolves.toMatchObject({organizationId:org,role:"editor"});
  const list=await listOrganizationInvitations(pool!,org);
  expect(list[0]?.status).toBe("accepted");
  const counts=await pool!.query<{users:string;members:string;audits:string}>(
   `SELECT (SELECT COUNT(*) FROM users WHERE email='new@example.test')::text AS users,
    (SELECT COUNT(*) FROM memberships WHERE organization_id=$1 AND user_id<>$2)::text AS members,
    (SELECT COUNT(*) FROM audit_logs WHERE organization_id=$1)::text AS audits`,[org,admin]);
  expect(counts.rows[0]).toEqual({users:"1",members:"1",audits:"2"});
  await expect(acceptOrganizationInvitation(pool!,{token:created.token,fullName:"Nuovo membro",password:"UnaPasswordSicura-2026"})).rejects.toThrow("Invito non valido");
 });
 it.skipIf(!pool)("revoca un invito e impedisce l'accettazione",async()=>{
  const created=await createOrganizationInvitation(pool!,org,admin,{email:"revoked@example.test",role:"viewer"});
  await revokeOrganizationInvitation(pool!,org,admin,created.invitation.id);
  expect((await listOrganizationInvitations(pool!,org))[0]?.status).toBe("revoked");
  await expect(acceptOrganizationInvitation(pool!,{token:created.token,fullName:"Membro",password:"UnaPasswordSicura-2026"})).rejects.toThrow("Invito non valido");
 });
 it.skipIf(!pool)("annulla account, membership e consumo invito se la sessione non può essere creata",async()=>{
  const created=await createOrganizationInvitation(pool!,org,admin,{email:"rollback@example.test",role:"analyst"});
  const c=await pool!.connect();
  try{
   await c.query(`CREATE FUNCTION pg_temp.reject_invitation_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced session failure'; END $$`);
   await c.query("CREATE TRIGGER reject_invitation_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_invitation_session()");
  }finally{c.release();}
  await expect(acceptOrganizationInvitation(pool!,{token:created.token,fullName:"Rollback User",password:"UnaPasswordSicura-2026"})).rejects.toThrow("forced session failure");
  const counts=await pool!.query<{users:string;members:string;accepted:string;sessions:string;audits:string}>(
   `SELECT (SELECT COUNT(*) FROM users WHERE email='rollback@example.test')::text AS users,
    (SELECT COUNT(*) FROM memberships WHERE organization_id=$1 AND user_id<>$2)::text AS members,
    (SELECT COUNT(*) FROM invitations WHERE id=$3 AND accepted_at IS NOT NULL)::text AS accepted,
    (SELECT COUNT(*) FROM sessions)::text AS sessions,
    (SELECT COUNT(*) FROM audit_logs WHERE organization_id=$1)::text AS audits`,[org,admin,created.invitation.id]);
  expect(counts.rows[0]).toEqual({users:"0",members:"0",accepted:"0",sessions:"0",audits:"1"});
 });

});
