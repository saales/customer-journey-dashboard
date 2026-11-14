import type { Pool, PoolClient } from "pg";
import { hashPassword } from "./password-hashing.js";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE=/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_STAGES=[
 {id:"visit",label:"Visita",position:0},
 {id:"lead",label:"Contatto",position:1},
 {id:"qualified",label:"Qualificato",position:2},
 {id:"opportunity",label:"Opportunità",position:3},
 {id:"customer",label:"Cliente",position:4},
] as const;

export interface InitialOrganizationInput {
 organizationName:string; organizationSlug:string; adminEmail:string;
 adminFullName:string; adminPassword:string; expectedDatabase:string;
}
export interface InitialOrganizationResult {
 database:string; organizationId:string; organizationSlug:string;
 adminUserId:string; adminEmail:string; initialStages:number;
}
export class BootstrapError extends Error {}

function validate(input:InitialOrganizationInput):void {
 if(!input||typeof input!=="object") throw new BootstrapError("Parametri iniziali non validi.");
 if(typeof input.organizationName!=="string"||!input.organizationName.trim()||input.organizationName.trim().length>150)
  throw new BootstrapError("Il nome dell'organizzazione deve contenere da 1 a 150 caratteri.");
 if(typeof input.organizationSlug!=="string"||!SLUG_RE.test(input.organizationSlug))
  throw new BootstrapError("Il codice organizzazione deve essere minuscolo e contenere solo lettere, numeri e trattini.");
 if(typeof input.adminEmail!=="string"||input.adminEmail.length>254||!EMAIL_RE.test(input.adminEmail.trim()))
  throw new BootstrapError("Email amministratore non valida.");
 if(typeof input.adminFullName!=="string"||!input.adminFullName.trim()||input.adminFullName.trim().length>150)
  throw new BootstrapError("Il nome amministratore deve contenere da 1 a 150 caratteri.");
 if(typeof input.expectedDatabase!=="string"||!input.expectedDatabase.trim()||input.expectedDatabase.length>63)
  throw new BootstrapError("È obbligatorio confermare il nome esatto del database.");
 if(typeof input.adminPassword!=="string"||input.adminPassword.length<12||input.adminPassword.length>1024)
  throw new BootstrapError("La password iniziale deve contenere almeno 12 caratteri.");
}

/**
 * One-time bootstrap for an empty database. Call only with a dedicated schema-owner
 * connection, never with the restricted HTTP runtime role. Everything is atomic.
 */
export async function bootstrapInitialPostgresOrganization(
 pool:Pick<Pool,"connect">,input:InitialOrganizationInput,
):Promise<InitialOrganizationResult>{
 validate(input);
 const passwordHash=await hashPassword(input.adminPassword);
 const client:PoolClient=await pool.connect();
 let begun=false, destroy=false;
 try{
  await client.query("BEGIN");begun=true;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["percorso:initial-organization-bootstrap"]);
  const target=await client.query<{database:string}>("SELECT current_database() AS database");
  const database=target.rows[0]?.database;
  if(database!==input.expectedDatabase) throw new BootstrapError("Il nome del database collegato non corrisponde alla conferma esplicita.");
  const existing=await client.query<{organizations:string;users:string}>(
   `SELECT (SELECT COUNT(*) FROM organizations)::text AS organizations,
           (SELECT COUNT(*) FROM users)::text AS users`);
  if(existing.rows[0]?.organizations!=="0"||existing.rows[0]?.users!=="0")
   throw new BootstrapError("Bootstrap rifiutato: il database non è vuoto. Nessun dato è stato modificato.");

  const org=await client.query<{id:string}>(
   "INSERT INTO organizations(name,slug,status) VALUES($1,$2,'active') RETURNING id::text AS id",
   [input.organizationName.trim(),input.organizationSlug]);
  const organizationId=org.rows[0]?.id;
  if(!organizationId||!UUID_RE.test(organizationId)) throw new Error("Creazione organizzazione non riuscita.");

  const user=await client.query<{id:string}>(
   `INSERT INTO users(email,password_hash,full_name,status,email_verified_at)
    VALUES($1,$2,$3,'active',NOW()) RETURNING id::text AS id`,
   [input.adminEmail.trim().toLowerCase(),passwordHash,input.adminFullName.trim()]);
  const adminUserId=user.rows[0]?.id;
  if(!adminUserId||!UUID_RE.test(adminUserId)) throw new Error("Creazione amministratore non riuscita.");

  await client.query(
   "INSERT INTO memberships(organization_id,user_id,role,status) VALUES($1::uuid,$2::uuid,'admin','active')",
   [organizationId,adminUserId]);
  for(const stage of INITIAL_STAGES){
   await client.query(
    `INSERT INTO funnel_stages(organization_id,id,label,position,is_active,is_system)
     VALUES($1::uuid,$2,$3,$4,TRUE,TRUE)`,
    [organizationId,stage.id,stage.label,stage.position]);
  }
  await client.query("SELECT set_config('app.current_organization_id',$1,true)",[organizationId]);
  await client.query(
   `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
    VALUES($1::uuid,$2::uuid,'organization.bootstrapped','organization',$1::text,
      jsonb_build_object('initialStageCount',$3::integer))`,
   [organizationId,adminUserId,INITIAL_STAGES.length]);
  await client.query("COMMIT");begun=false;
  return {database,organizationId,organizationSlug:input.organizationSlug,adminUserId,
   adminEmail:input.adminEmail.trim().toLowerCase(),initialStages:INITIAL_STAGES.length};
 }catch(error){
  if(begun){
   try{await client.query("ROLLBACK");}
   catch{destroy=true;}
  }
  throw error;
 }finally{client.release(destroy);}
}
