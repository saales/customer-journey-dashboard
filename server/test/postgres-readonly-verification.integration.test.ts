import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { loadPostgresMigrations,type PostgresMigration } from "../src/postgres-migrations.js";
import { verifyPostgresReadOnly } from "../src/postgres-readonly-verification.js";
import { createHttpTestEnvironment,integrationDatabaseUrl,type HttpTestEnvironment } from "./helpers/http-test-environment.js";

const dbUrl=integrationDatabaseUrl();
let env:HttpTestEnvironment;
let migrations:PostgresMigration[]=[];
beforeAll(async()=>{
 if(!dbUrl)return;
 env=await createHttpTestEnvironment();
 migrations=(await loadPostgresMigrations()).map(m=>({...m,sql:m.sql.replaceAll("percorso_app",env.runtimeRole)}));
},60_000);
afterAll(async()=>{await env?.close();});
const opts=()=>({expectedDatabase:env.databaseName,migrations,requireSsl:false});
const check=(report:Awaited<ReturnType<typeof verifyPostgresReadOnly>>,id:string)=>report.checks.find(c=>c.id===id)!;

describe.skipIf(!dbUrl)("Verificatore PostgreSQL read-only",()=>{
 it("verifica schema, ruolo runtime, RLS e checksum senza errori",async()=>{
  const report=await verifyPostgresReadOnly(env.runtimePool,opts());
  expect(report.ok,JSON.stringify(report.checks.filter(c=>c.status==="fail"))).toBe(true);
  for(const id of ["identity.database","session.read_only","schema.tables","rls.tenant_tables","role.safe","role.rls_active","role.required_privileges","role.forbidden_privileges","migrations.history","migrations.pending"])
   expect(check(report,id).status,id).toBe("pass");
 });
 it("si arresta dopo il controllo identità se il database non coincide",async()=>{
  const report=await verifyPostgresReadOnly(env.runtimePool,{...opts(),expectedDatabase:"database-non-corrispondente"});
  expect(report.ok).toBe(false);
  expect(report.checks.map(c=>c.id)).toEqual(["identity.database","session.read_only"]);
 });
 it("rileva RLS disattivata e la ripristina nel test",async()=>{
  await env.adminPool.query("ALTER TABLE events DISABLE ROW LEVEL SECURITY");
  try {
   const report=await verifyPostgresReadOnly(env.runtimePool,opts());
   expect(check(report,"rls.tenant_tables").status).toBe("fail");
   expect(check(report,"rls.tenant_tables").detail).toMatch(/events: RLS disattivata/);
  } finally { await env.adminPool.query("ALTER TABLE events ENABLE ROW LEVEL SECURITY"); }
 });
 it("rileva una policy tenant senza predicati di tenant in USING/WITH CHECK",async()=>{
  await env.adminPool.query("DROP POLICY tenant_isolation ON customers");
  await env.adminPool.query("CREATE POLICY tenant_isolation ON customers USING (true) WITH CHECK (true)");
  try {
   const report=await verifyPostgresReadOnly(env.runtimePool,opts());
   expect(check(report,"rls.tenant_tables").status).toBe("fail");
   expect(check(report,"rls.tenant_tables").detail).toMatch(/USING non vincola/);
  } finally {
   await env.adminPool.query("DROP POLICY tenant_isolation ON customers");
   await env.adminPool.query(`CREATE POLICY tenant_isolation ON customers
    USING (organization_id::text = NULLIF(current_setting('app.current_organization_id', true), ''))
    WITH CHECK (organization_id::text = NULLIF(current_setting('app.current_organization_id', true), ''))`);
  }
 });
 it("non applica migrazioni pendenti e le segnala",async()=>{
  const newer=[...migrations,{version:"999",name:"999_future.sql",sql:"SELECT 1;"}];
  const report=await verifyPostgresReadOnly(env.runtimePool,{...opts(),migrations:newer});
  expect(check(report,"migrations.pending").status).toBe("fail");
  expect(check(report,"migrations.pending").detail).toContain("999");
 });
});
