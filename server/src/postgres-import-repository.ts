import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { CHANNELS } from "./types.js";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_IMPORT_ROWS=10000;
export interface PostgresImportRow { externalId:string; channel:string; createdAt:string; stage:string; occurredAt:string; }
export interface PostgresImportResult { message:string; batchId:string; importedCustomers:number; importedRows:number; importedEvents:number; }
export class PostgresImportError extends Error {
 constructor(public readonly status:400|409,message:string){super(message);}
}
interface CustomerGroup { externalId:string;channel:string;createdAt:string;events:PostgresImportRow[]; }
function validDate(v:unknown):v is string {
 return typeof v==="string"&&DATE_RE.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
}
function validateRows(fileName:string,rows:PostgresImportRow[],stages:{id:string;position:number}[]):{
 fileName:string;rows:PostgresImportRow[];customers:CustomerGroup[];fingerprint:string;
}{
 if(typeof fileName!=="string"||!fileName.trim()||fileName.length>255||/[\u0000-\u001f]/.test(fileName))
  throw new PostgresImportError(400,"Nome del file non valido.");
 if(!Array.isArray(rows)||rows.length===0) throw new PostgresImportError(400,"Il file non contiene righe da importare.");
 if(rows.length>MAX_IMPORT_ROWS) throw new PostgresImportError(400,`Il file supera il limite di ${MAX_IMPORT_ROWS} righe.`);
 const positions=new Map(stages.map(s=>[s.id,s.position]));
 if(positions.get("visit")!==0) throw new PostgresImportError(400,"Configurazione delle fasi non valida.");
 const normalized=rows.map((row,index)=>{
  if(!row||typeof row!=="object") throw new PostgresImportError(400,`Riga ${index+2}: formato non valido.`);
  const externalId=typeof row.externalId==="string"?row.externalId.trim():"";
  const channel=typeof row.channel==="string"?row.channel.trim():"";
  const createdAt=typeof row.createdAt==="string"?row.createdAt.trim():"";
  const stage=typeof row.stage==="string"?row.stage.trim():"";
  const occurredAt=typeof row.occurredAt==="string"?row.occurredAt.trim():"";
  if(!externalId||externalId.length>100) throw new PostgresImportError(400,`Riga ${index+2}: identificativo cliente mancante o troppo lungo.`);
  if(!(CHANNELS as readonly string[]).includes(channel)) throw new PostgresImportError(400,`Riga ${index+2}: canale non valido.`);
  if(!validDate(createdAt)) throw new PostgresImportError(400,`Riga ${index+2}: data di ingresso non valida.`);
  if(!positions.has(stage)) throw new PostgresImportError(400,`Riga ${index+2}: fase ${stage||"non specificata"} non valida o non attiva.`);
  if(!validDate(occurredAt)||occurredAt<createdAt) throw new PostgresImportError(400,`Riga ${index+2}: data dell'evento non valida.`);
  return {externalId,channel,createdAt,stage,occurredAt};
 });
 const groups=new Map<string,CustomerGroup>();
 for(const row of normalized){
  const group=groups.get(row.externalId);
  if(!group){groups.set(row.externalId,{externalId:row.externalId,channel:row.channel,createdAt:row.createdAt,events:[row]});continue;}
  if(group.channel!==row.channel) throw new PostgresImportError(400,`Il cliente ${row.externalId} ha canali differenti.`);
  if(group.createdAt!==row.createdAt) throw new PostgresImportError(400,`Il cliente ${row.externalId} ha date di ingresso differenti.`);
  group.events.push(row);
 }
 const customers=[...groups.values()];
 for(const customer of customers){
  customer.events.sort((a,b)=>(positions.get(a.stage)??Infinity)-(positions.get(b.stage)??Infinity));
  const seen=new Set<string>();let prev=-1,prevDate=customer.createdAt;
  if(!customer.events.some(e=>e.stage==="visit")) throw new PostgresImportError(400,`Il cliente ${customer.externalId} non contiene la fase visit.`);
  for(const event of customer.events){
   const position=positions.get(event.stage)!;
   if(position<=prev||seen.has(event.stage)) throw new PostgresImportError(400,`Il cliente ${customer.externalId} contiene fasi non valide, duplicate o fuori ordine.`);
   if(event.stage==="visit"&&event.occurredAt!==customer.createdAt) throw new PostgresImportError(400,`La fase visit del cliente ${customer.externalId} deve coincidere con la data di ingresso.`);
   if(event.occurredAt<prevDate) throw new PostgresImportError(400,`Le date degli eventi del cliente ${customer.externalId} non rispettano l'ordine cronologico.`);
   seen.add(event.stage);prev=position;prevDate=event.occurredAt;
  }
 }
 const canonical=[...normalized].sort((a,b)=>a.externalId.localeCompare(b.externalId)||(positions.get(a.stage)??0)-(positions.get(b.stage)??0));
 const fingerprint=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
 return {fileName:fileName.trim(),rows:normalized,customers,fingerprint};
}

/** Importa clienti, eventi, batch e audit log in una sola transazione tenant-scoped. */
export async function importPostgresCustomers(
 pool:Pick<Pool,"connect">,organizationId:string,userId:string,fileName:string,rows:PostgresImportRow[],
):Promise<PostgresImportResult>{
 if(!UUID_RE.test(organizationId)||!UUID_RE.test(userId)) throw new PostgresImportError(400,"Contesto utente o organizzazione non valido.");
 return withTenantTransaction(pool,organizationId,async client=>{
  const stages=await client.query<{id:string;position:number}>(
   "SELECT id,position FROM funnel_stages WHERE organization_id=$1::uuid AND is_active=TRUE ORDER BY position",[organizationId]);
  const validated=validateRows(fileName,rows,stages.rows);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[organizationId,validated.fingerprint]);
  const duplicate=await client.query("SELECT id FROM import_batches WHERE organization_id=$1::uuid AND fingerprint=$2",[organizationId,validated.fingerprint]);
  if(duplicate.rowCount) throw new PostgresImportError(409,"Questo contenuto è già stato importato.");
  let importedEvents=0;
  for(const customer of validated.customers){
   const inserted=await client.query<{id:string}>(
    `INSERT INTO customers(organization_id,external_id,channel,created_at)
     VALUES($1::uuid,$2,$3,$4::date::timestamp AT TIME ZONE 'UTC') RETURNING id::text AS id`,
    [organizationId,customer.externalId,customer.channel,customer.createdAt]);
   const id=inserted.rows[0]?.id;if(!id)throw new Error("Creazione cliente importato non riuscita.");
   for(const event of customer.events){
    await client.query(
     `INSERT INTO events(organization_id,customer_id,stage_id,occurred_at)
      VALUES($1::uuid,$2::bigint,$3,$4::date::timestamp AT TIME ZONE 'UTC')`,
     [organizationId,id,event.stage,event.occurredAt]);
    importedEvents++;
   }
  }
  const batch=await client.query<{id:string}>(
   `INSERT INTO import_batches(organization_id,fingerprint,file_name,customer_count,row_count,imported_by)
    VALUES($1::uuid,$2,$3,$4,$5,$6::uuid) RETURNING id::text AS id`,
   [organizationId,validated.fingerprint,validated.fileName,validated.customers.length,validated.rows.length,userId]);
  const batchId=batch.rows[0]?.id;if(!batchId)throw new Error("Registrazione importazione non riuscita.");
  await client.query(
   `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
    VALUES($1::uuid,$2::uuid,'data.imported','import_batch',$3,$4::jsonb)`,
   [organizationId,userId,batchId,JSON.stringify({customerCount:validated.customers.length,rowCount:validated.rows.length,eventCount:importedEvents})]);
  return {message:"Importazione completata.",batchId,importedCustomers:validated.customers.length,importedRows:validated.rows.length,importedEvents};
 });
}
