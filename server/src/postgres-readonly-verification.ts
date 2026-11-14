import type { Pool, PoolClient } from "pg";
import { planPostgresMigrations, type PostgresMigration } from "./postgres-migrations.js";
import { inspectPostgresRuntimeRole } from "./postgres-runtime-preflight.js";

export type CheckStatus = "pass" | "fail" | "warn";
export interface ReadOnlyCheck { id: string; title: string; status: CheckStatus; detail: string }
export interface ReadOnlyVerificationOptions {
  expectedDatabase: string;
  migrations: PostgresMigration[];
  roleMode?: "runtime" | "any";
  requireSsl?: boolean;
  connectionHost?: string;
}
export interface ReadOnlyVerificationReport {
  generatedAt: string;
  mode: "read-only";
  target: { database: string; user: string; serverVersion: string; ssl: boolean | null; pooledEndpoint: boolean | null };
  checks: ReadOnlyCheck[];
  summary: { pass: number; warn: number; fail: number };
  ok: boolean;
}
export const EXPECTED_TABLES = [
  "api_request_limits", "audit_logs", "customers", "events", "funnel_stages", "import_batches",
  "invitations", "login_attempt_limits", "memberships", "organizations", "password_reset_tokens",
  "schema_migrations", "sessions", "users",
] as const;
const TENANT_TABLES = ["customers", "events", "funnel_stages", "import_batches", "audit_logs", "invitations"] as const;
const FORBIDDEN: Array<[string, string]> = [
  ["audit_logs","UPDATE"],["audit_logs","DELETE"],["audit_logs","TRUNCATE"],
  ["sessions","UPDATE"],["sessions","TRUNCATE"],["users","DELETE"],["users","TRUNCATE"],
  ["organizations","INSERT"],["organizations","DELETE"],["organizations","TRUNCATE"],
  ["memberships","DELETE"],["memberships","TRUNCATE"],["import_batches","UPDATE"],["import_batches","DELETE"],
  ["customers","TRUNCATE"],["events","TRUNCATE"],["funnel_stages","DELETE"],
  ["schema_migrations","INSERT"],["schema_migrations","UPDATE"],["schema_migrations","DELETE"],
];
const add = (checks: ReadOnlyCheck[], id: string, title: string, status: CheckStatus, detail: string) =>
  checks.push({ id, title, status, detail });

export async function verifyPostgresReadOnly(
  pool: Pick<Pool, "connect">, options: ReadOnlyVerificationOptions,
): Promise<ReadOnlyVerificationReport> {
  if (!options.expectedDatabase?.trim()) throw new Error("Indicare esplicitamente il database atteso (--expect-database).");
  const checks: ReadOnlyCheck[] = [];
  const target: ReadOnlyVerificationReport["target"] = { database:"", user:"", serverVersion:"", ssl:null, pooledEndpoint:null };
  const client: PoolClient = await pool.connect();
  let opened = false;
  let failure: unknown;
  let identityOk = false;
  try {
    await client.query("BEGIN READ ONLY"); opened = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const identity = await client.query<{database:string; user:string; version:string; readonly:string; ssl:boolean|null}>(
      `SELECT current_database() AS database, current_user AS "user", current_setting('server_version') AS version,
       current_setting('transaction_read_only') AS readonly,
       (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);
    const row = identity.rows[0]!;
    Object.assign(target,{database:row.database,user:row.user,serverVersion:row.version,ssl:row.ssl,
      pooledEndpoint:options.connectionHost ? /-pooler\./.test(options.connectionHost) : null});
    identityOk = row.database === options.expectedDatabase;
    add(checks,"identity.database","Database di destinazione",identityOk?"pass":"fail",
      identityOk ? `database "${row.database}" confermato` : `collegato a "${row.database}", atteso "${options.expectedDatabase}". Nessun altro controllo eseguito.`);
    add(checks,"session.read_only","Transazione read-only",row.readonly==="on"?"pass":"fail",`transaction_read_only=${row.readonly}`);
    if (identityOk) {
      add(checks,"transport.tls","Connessione TLS",row.ssl===true?"pass":options.requireSsl===false?"warn":"fail",
        row.ssl===true?"TLS attivo":"TLS non rilevato");
      if (target.pooledEndpoint) add(checks,"transport.pooler","Endpoint database","warn","Endpoint pooler rilevato: usare endpoint diretto per operazioni di migrazione.");
      const tables = await client.query<{name:string}>(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
      const present = new Set(tables.rows.map(r=>r.name));
      const missing = EXPECTED_TABLES.filter(t=>!present.has(t));
      add(checks,"schema.tables","Tabelle attese",missing.length?"fail":"pass",
        missing.length ? `mancanti: ${missing.join(", ")}` : `${EXPECTED_TABLES.length} tabelle presenti`);
      const policies = await client.query<{table:string; enabled:boolean; forced:boolean; name:string; cmd:string; qual:string|null; check_expr:string|null}>(
        `SELECT c.relname AS table,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
          p.policyname AS name,p.cmd,p.qual,p.with_check AS check_expr
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
         WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[[...TENANT_TABLES]]);
      const rlsProblems = TENANT_TABLES.flatMap(t=>{
        const rows=policies.rows.filter(r=>r.table===t);
        if(!rows.length) return [`${t}: tabella o policy assente`];
        const tenant=rows.find(r=>r.name==="tenant_isolation" && r.cmd==="ALL");
        const problems:string[]=[];
        if(!rows[0]!.enabled) problems.push(`${t}: RLS disattivata`);
        if(!tenant) problems.push(`${t}: policy tenant_isolation ALL mancante`);
        else {
          const using=tenant.qual??"", check=tenant.check_expr??"";
          if(!/organization_id/i.test(using)||!/current_setting/i.test(using)) problems.push(`${t}: USING non vincola organization_id al tenant corrente`);
          if(!/organization_id/i.test(check)||!/current_setting/i.test(check)) problems.push(`${t}: WITH CHECK non vincola organization_id al tenant corrente`);
        }
        if(t==="invitations"&&!rows.some(r=>r.name==="invitation_token_lookup")) problems.push("invitations: policy token lookup mancante");
        return problems;
      });
      add(checks,"rls.tenant_tables","RLS e predicate tenant",rlsProblems.length?"fail":"pass",
        rlsProblems.length?rlsProblems.join("; "):`${TENANT_TABLES.length} tabelle con policy e predicati tenant`);
      if(missing.length) add(checks,"role.skipped","Verifica ruolo","warn","Saltata: schema incompleto.");
      else {
        const role=await inspectPostgresRuntimeRole(client);
        if((options.roleMode??"runtime")==="runtime"){
          const unsafe=[role.superuser&&"SUPERUSER",role.bypassRls&&"BYPASSRLS",role.inheritsPrivileges&&"INHERIT",
            role.canCreateRoles&&"CREATEROLE",role.canCreateDatabases&&"CREATEDB",role.canReplicate&&"REPLICATION",
            role.hasRoleMembership&&"membership ruoli",role.canCreateSchema&&"CREATE schema",role.ownedTables.length&&"owner tabelle"].filter(Boolean);
          add(checks,"role.safe","Ruolo runtime non privilegiato",unsafe.length?"fail":"pass",unsafe.join(", ")||"nessun privilegio elevato");
          add(checks,"role.rls_active","RLS attiva per il ruolo",role.rlsDisabledTables.length?"fail":"pass",role.rlsDisabledTables.join(", ")||"attiva");
          add(checks,"role.required_privileges","Privilegi necessari",role.missingPrivileges.length?"fail":"pass",role.missingPrivileges.join(", ")||"presenti");
          const forbidden=await client.query<{table:string;privilege:string}>(
            `SELECT f.t AS table,f.p AS privilege FROM unnest($1::text[],$2::text[]) AS f(t,p)
             WHERE to_regclass(format('public.%I',f.t)) IS NOT NULL
             AND has_table_privilege(current_user,format('public.%I',f.t),f.p)`,
            [FORBIDDEN.map(x=>x[0]),FORBIDDEN.map(x=>x[1])]);
          add(checks,"role.forbidden_privileges","Privilegi distruttivi",forbidden.rowCount?"fail":"pass",
            forbidden.rows.map(r=>`${r.table}:${r.privilege}`).join(", ")||"nessuno");
        } else add(checks,"role.report","Ruolo in modalità report","warn",`ruolo ${role.role}; non certifica la sicurezza runtime`);
      }
    }
  } catch(e) { failure=e; }
  finally {
    if(opened) try { await client.query("ROLLBACK"); } catch(e) { failure??=e; client.release(true); }
    if(!failure) client.release(); 
  }
  if(failure) throw failure;
  if(identityOk){
    try {
      const plan=await planPostgresMigrations(pool,options.migrations);
      add(checks,"migrations.history","Checksum migrazioni",plan.drift.length?"fail":"pass",plan.drift.join("; ")||`${plan.applied.length}/${options.migrations.length} applicate`);
      add(checks,"migrations.pending","Migrazioni pendenti",plan.pending.length?"fail":"pass",plan.pending.join(", ")||"nessuna");
    } catch(e) { add(checks,"migrations.history","Storico migrazioni","fail",e instanceof Error?e.message:"errore"); }
  }
  const summary={pass:checks.filter(c=>c.status==="pass").length,warn:checks.filter(c=>c.status==="warn").length,fail:checks.filter(c=>c.status==="fail").length};
  return {generatedAt:new Date().toISOString(),mode:"read-only",target,checks,summary,ok:summary.fail===0};
}
