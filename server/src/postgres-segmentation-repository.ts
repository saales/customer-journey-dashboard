import type { Pool } from "pg";
import { CHANNELS, type Filters } from "./types.js";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
export type SegmentDimension="channel"|"stage"|"period"|"combination";
export interface SegmentRow { id:string; label:string; customers:number; share:number; conversionRate:number; }
export interface SegmentAnalysis { totalCustomers:number; channels:SegmentRow[]; stages:SegmentRow[]; periods:SegmentRow[]; combinations:SegmentRow[]; }
export interface SegmentCustomer {
  id:string; channel:string; createdAt:string; stage:string; stageLabel:string; stageActive:boolean;
}
function assertInput(org:string,f:Filters):void {
  const valid=(v:unknown):v is string=>typeof v==="string"&&DATE_RE.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  if(!UUID_RE.test(org)) throw new Error("Identificativo organizzazione non valido.");
  if(!f||!valid(f.from)||!valid(f.to)||f.from>f.to) throw new Error("Intervallo date non valido.");
  if(f.channel && !(CHANNELS as readonly string[]).includes(f.channel)) throw new Error("Canale non valido.");
}
async function latestCustomers(pool:Pick<Pool,"connect">,org:string,f:Filters):Promise<SegmentCustomer[]> {
  return withTenantTransaction(pool,org,async client=>{
    const result=await client.query<{
      id:string;channel:string;createdAt:string;stage:string;stageLabel:string;stageActive:boolean;
    }>(
      `WITH ranked_events AS (
        SELECT c.id::text AS id,c.channel,
          to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS "createdAt",
          e.stage_id AS stage,fs.label AS "stageLabel",fs.is_active AS "stageActive",
          ROW_NUMBER() OVER (
            PARTITION BY c.id
            ORDER BY CASE WHEN fs.id IS NULL THEN -1 ELSE fs.position END DESC,
                     e.occurred_at DESC,e.id DESC
          ) AS row_number
        FROM customers c
        JOIN events e ON e.organization_id=c.organization_id AND e.customer_id=c.id
        LEFT JOIN funnel_stages fs ON fs.organization_id=c.organization_id AND fs.id=e.stage_id
        WHERE c.organization_id=$1::uuid
          AND c.created_at >= $2::date AND c.created_at < ($3::date + INTERVAL '1 day')
          AND ($4::text IS NULL OR c.channel=$4)
      )
      SELECT id,channel,"createdAt",stage,
        COALESCE("stageLabel",'Fase non configurata') AS "stageLabel",
        COALESCE("stageActive",FALSE) AS "stageActive"
      FROM ranked_events WHERE row_number=1 ORDER BY id DESC`,
      [org,f.from,f.to,f.channel??null],
    );
    return result.rows;
  });
}
const bucket=(c:SegmentCustomer)=>c.stageActive?c.stage:"inactive";
const bucketLabel=(c:SegmentCustomer)=>c.stageActive?c.stageLabel:"Fase disattivata";
const pct=(n:number,d:number)=>d===0?0:Math.round(n/d*1000)/10;
function buildRows(
 customers:SegmentCustomer[], key:(c:SegmentCustomer)=>string,
 label:(c:SegmentCustomer)=>string,total:number,
):SegmentRow[] {
 const groups=new Map<string,{label:string;customers:number;converted:number}>();
 for(const c of customers){
  const id=key(c),g=groups.get(id);
  if(g){g.customers++;if(c.stage==="customer")g.converted++;}
  else groups.set(id,{label:label(c),customers:1,converted:c.stage==="customer"?1:0});
 }
 return [...groups.entries()].map(([id,g])=>({
  id,label:g.label,customers:g.customers,share:pct(g.customers,total),
  conversionRate:pct(g.converted,g.customers),
 })).sort((a,b)=>b.customers-a.customers);
}
export async function getPostgresSegments(
 pool:Pick<Pool,"connect">,org:string,f:Filters,
):Promise<SegmentAnalysis>{
 assertInput(org,f);
 const customers=await latestCustomers(pool,org,f),total=customers.length;
 return {
  totalCustomers:total,
  channels:buildRows(customers,c=>c.channel,c=>c.channel,total),
  stages:buildRows(customers,bucket,bucketLabel,total),
  periods:buildRows(customers,c=>c.createdAt.slice(0,7),c=>c.createdAt.slice(0,7),total),
  combinations:buildRows(customers,c=>`${encodeURIComponent(c.channel)}~${encodeURIComponent(bucket(c))}`,
    c=>`${c.channel} · ${bucketLabel(c)}`,total),
 };
}
export async function getPostgresSegmentCustomers(
 pool:Pick<Pool,"connect">,org:string,f:Filters,dimension:SegmentDimension,segmentId:string,
):Promise<SegmentCustomer[]>{
 assertInput(org,f);
 if(!["channel","stage","period","combination"].includes(dimension)) throw new Error("Dimensione del segmento non valida.");
 if(typeof segmentId!=="string"||!segmentId.trim()||segmentId.length>255) throw new Error("Identificativo del segmento non valido.");
 const customers=await latestCustomers(pool,org,f);
 switch(dimension){
  case "channel":return customers.filter(c=>c.channel===segmentId);
  case "stage":return customers.filter(c=>bucket(c)===segmentId);
  case "period":return customers.filter(c=>c.createdAt.slice(0,7)===segmentId);
  case "combination":{
   const sep=segmentId.indexOf("~");if(sep<0)return [];
   let channel:string,stage:string;
   try{channel=decodeURIComponent(segmentId.slice(0,sep));stage=decodeURIComponent(segmentId.slice(sep+1));}
   catch{return [];}
   return customers.filter(c=>c.channel===channel&&bucket(c)===stage);
  }
 }
}
