import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { bootstrapInitialPostgresOrganization } from "./postgres-bootstrap.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../");
const local=resolve(root,".env.local"),fallback=resolve(root,".env");
if(existsSync(local)) dotenv.config({path:local});
else if(existsSync(fallback)) dotenv.config({path:fallback});

async function main():Promise<void>{
 if(!process.argv.includes("--confirm-empty-database")){
  throw new Error("Operazione non eseguita. Ripetere aggiungendo --confirm-empty-database dopo aver verificato il database di destinazione.");
 }
 const connectionString=process.env.BOOTSTRAP_DATABASE_URL?.trim();
 if(!connectionString) throw new Error("BOOTSTRAP_DATABASE_URL obbligatoria: usare una connessione amministrativa separata dal ruolo HTTP.");
 const required=(name:string)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`Variabile ${name} obbligatoria.`);return value;};
 const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:10000,application_name:"percorso-initial-bootstrap"});
 try{
  const result=await bootstrapInitialPostgresOrganization(pool,{
   expectedDatabase:required("BOOTSTRAP_CONFIRM_DATABASE"),
   organizationName:required("BOOTSTRAP_ORGANIZATION_NAME"),
   organizationSlug:required("BOOTSTRAP_ORGANIZATION_SLUG"),
   adminEmail:required("BOOTSTRAP_ADMIN_EMAIL"),
   adminFullName:required("BOOTSTRAP_ADMIN_NAME"),
   adminPassword:required("BOOTSTRAP_ADMIN_PASSWORD"),
  });
  console.log("Organizzazione iniziale creata.");
  console.log("Database:",result.database);
  console.log("Codice organizzazione:",result.organizationSlug);
  console.log("Email amministratore:",result.adminEmail);
  console.log("Fasi iniziali:",result.initialStages);
  console.log("La password non viene stampata. Conservarla in un gestore credenziali.");
 }finally{await pool.end();}
}
main().catch(error=>{
 console.error("Bootstrap PostgreSQL non riuscito:",error instanceof Error?error.message:"errore sconosciuto");
 process.exitCode=1;
});
