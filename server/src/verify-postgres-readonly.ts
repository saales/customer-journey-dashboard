import { postgresPool } from "./postgres.js";
import { loadPostgresMigrations } from "./postgres-migrations.js";
import { verifyPostgresReadOnly } from "./postgres-readonly-verification.js";

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
async function main(){
 const expectedDatabase=arg("--expect-database")??process.env.READONLY_EXPECT_DATABASE;
 if(!expectedDatabase||expectedDatabase.startsWith("--")) throw new Error("Specificare --expect-database <nome>.");
 const role=arg("--role")??"runtime";
 if(role!=="runtime"&&role!=="any") throw new Error("--role deve essere runtime oppure any.");
 let host:string|undefined; try{host=new URL(process.env.DATABASE_URL??"").hostname;}catch{}
 try{
  const report=await verifyPostgresReadOnly(postgresPool,{expectedDatabase,migrations:await loadPostgresMigrations(),
   roleMode:role,requireSsl:!process.argv.includes("--allow-no-ssl"),connectionHost:host});
  if(process.argv.includes("--json")) console.log(JSON.stringify(report,null,2));
  else {
   console.log(`Verifica PostgreSQL read-only — ${report.generatedAt}`);
   console.log(`Database: ${report.target.database}; ruolo: ${report.target.user}; TLS: ${report.target.ssl}`);
   for(const c of report.checks) console.log(`[${c.status.toUpperCase()}] ${c.id}: ${c.detail}`);
   console.log(`Esito: ${report.ok?"SUPERATO":"NON SUPERATO"} — ${report.summary.pass} ok, ${report.summary.warn} avvisi, ${report.summary.fail} errori`);
  }
  if(!report.ok) process.exitCode=2;
 }finally{await postgresPool.end();}
}
main().catch(e=>{console.error("Verifica read-only non riuscita:",e instanceof Error?e.message:"errore");process.exitCode=1;});
