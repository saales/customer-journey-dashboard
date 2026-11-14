import { afterAll,beforeEach,describe,expect,it } from "vitest";
import { Pool } from "pg";
import { bootstrapInitialPostgresOrganization } from "../src/postgres-bootstrap.js";
import { verifyPassword } from "../src/password-hashing.js";

const connectionString=process.env.DATABASE_URL;
const pool=connectionString?new Pool({connectionString,max:1,connectionTimeoutMillis:5000}):null;
let databaseName="";

beforeEach(async()=>{
 if(!pool)return;
 const c=await pool.connect();
 try{
  const db=await c.query<{name:string}>("SELECT current_database() AS name");
  databaseName=db.rows[0]!.name;
  await c.query("DROP TABLE IF EXISTS pg_temp.audit_logs,pg_temp.funnel_stages,pg_temp.memberships,pg_temp.users,pg_temp.organizations CASCADE");
  await c.query(`CREATE TEMP TABLE organizations(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name VARCHAR(150) NOT NULL,
   slug VARCHAR(100) NOT NULL UNIQUE,status VARCHAR(20) NOT NULL,
   created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
  ) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE users(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),email VARCHAR(254) NOT NULL,
   password_hash TEXT NOT NULL,full_name VARCHAR(150) NOT NULL,status VARCHAR(20) NOT NULL,
   email_verified_at TIMESTAMPTZ,UNIQUE(email)
  ) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE memberships(
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
   user_id UUID NOT NULL,role VARCHAR(20) NOT NULL,status VARCHAR(20) NOT NULL,
   UNIQUE(organization_id,user_id)
  ) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE funnel_stages(
   organization_id UUID NOT NULL,id VARCHAR(80) NOT NULL,label VARCHAR(50) NOT NULL,
   position INTEGER NOT NULL,is_active BOOLEAN NOT NULL,is_system BOOLEAN NOT NULL,
   PRIMARY KEY(organization_id,id),UNIQUE(organization_id,position)
  ) ON COMMIT PRESERVE ROWS`);
  await c.query(`CREATE TEMP TABLE audit_logs(
   id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id UUID NOT NULL,
   actor_user_id UUID NOT NULL,action VARCHAR(100) NOT NULL,resource_type VARCHAR(100),
   resource_id TEXT,details JSONB NOT NULL DEFAULT '{}'::jsonb
  ) ON COMMIT PRESERVE ROWS`);
 }finally{c.release();}
});

afterAll(async()=>{await pool?.end();});

const input=(expectedDatabase:string)=>({
 expectedDatabase,organizationName:"Organizzazione integrazione",
 organizationSlug:"organizzazione-integrazione",adminEmail:"admin@example.test",
 adminFullName:"Admin Integrazione",adminPassword:"UnaPasswordDiTest-Lunga-2026",
});

describe("Bootstrap PostgreSQL — integrazione database",()=>{
 it.skipIf(!pool)("crea il tenant, l'amministratore, il funnel e l'audit in PostgreSQL",async()=>{
  const result=await bootstrapInitialPostgresOrganization(pool!,input(databaseName));
  expect(result.initialStages).toBe(5);
  const c=await pool!.connect();
  try{
   const counts=await c.query<{organizations:string;users:string;memberships:string;stages:string;audits:string}>(
    `SELECT
      (SELECT COUNT(*) FROM organizations)::text AS organizations,
      (SELECT COUNT(*) FROM users)::text AS users,
      (SELECT COUNT(*) FROM memberships)::text AS memberships,
      (SELECT COUNT(*) FROM funnel_stages)::text AS stages,
      (SELECT COUNT(*) FROM audit_logs)::text AS audits`);
   expect(counts.rows[0]).toEqual({organizations:"1",users:"1",memberships:"1",stages:"5",audits:"1"});
   const user=await c.query<{password_hash:string}>("SELECT password_hash FROM users WHERE email='admin@example.test'");
   expect(user.rows[0]?.password_hash).not.toBe(input(databaseName).adminPassword);
   expect(await verifyPassword(input(databaseName).adminPassword,user.rows[0]!.password_hash)).toBe(true);
   const stage=await c.query<{id:string;label:string;position:number}>(
    "SELECT id,label,position FROM funnel_stages ORDER BY position");
   expect(stage.rows.map(x=>[x.id,x.label,x.position])).toEqual([
    ["visit","Visita",0],["lead","Contatto",1],["qualified","Qualificato",2],
    ["opportunity","Opportunità",3],["customer","Cliente",4],
   ]);
  }finally{c.release();}
  await expect(bootstrapInitialPostgresOrganization(pool!,input(databaseName))).rejects.toThrow("database non è vuoto");
 });

 it.skipIf(!pool)("annulla ogni inserimento se una fase funnel non può essere creata",async()=>{
  const c=await pool!.connect();
  try{
   await c.query(`CREATE FUNCTION pg_temp.reject_funnel_stage() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced stage failure'; END $$`);
   await c.query("CREATE TRIGGER reject_funnel_stage BEFORE INSERT ON funnel_stages FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_funnel_stage()");
  }finally{c.release();}
  await expect(bootstrapInitialPostgresOrganization(pool!,input(databaseName))).rejects.toThrow("forced stage failure");
  const c2=await pool!.connect();
  try{
   const counts=await c2.query<{organizations:string;users:string;memberships:string;stages:string;audits:string}>(
    `SELECT
      (SELECT COUNT(*) FROM organizations)::text AS organizations,
      (SELECT COUNT(*) FROM users)::text AS users,
      (SELECT COUNT(*) FROM memberships)::text AS memberships,
      (SELECT COUNT(*) FROM funnel_stages)::text AS stages,
      (SELECT COUNT(*) FROM audit_logs)::text AS audits`);
   expect(counts.rows[0]).toEqual({organizations:"0",users:"0",memberships:"0",stages:"0",audits:"0"});
  }finally{c2.release();}
 });
});
