import type { Pool, PoolClient } from "pg";
import { CHANNELS, type Filters } from "./types.js";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export interface PostgresFunnelStep { stage: string; label: string; count: number; conversionFromPrevious: number; conversionFromVisit: number; }
export interface PostgresChannelRow { channel: string; visits: number; leads: number; customers: number; visitToLead: number; visitToCustomer: number; }
export interface PostgresMonthPoint { month: string; visits: number; customers: number; conversion: number; }
export interface PostgresSummary {
  filters: Filters; funnel: PostgresFunnelStep[];
  kpis: { visits: number; leads: number; customers: number; conversionRate: number; avgDaysToCustomer: number | null };
}
function assertTenant(id: string): void {
  if (!UUID_RE.test(id)) throw new Error("Identificativo organizzazione non valido.");
}
function assertFilters(filters: Filters): void {
  const valid = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  if (!filters || !valid(filters.from) || !valid(filters.to) || filters.from > filters.to)
    throw new Error("Intervallo date non valido.");
  if (filters.channel && !(CHANNELS as readonly string[]).includes(filters.channel))
    throw new Error("Canale non valido.");
}
const pct = (n: number, d: number) => d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
interface CountRow { stage: string; count: string; }
interface StageRow { id: string; label: string; }

async function readFunnel(client: PoolClient, org: string, f: Filters): Promise<PostgresFunnelStep[]> {
  const stages = await client.query<StageRow>(
    `SELECT id,label FROM funnel_stages WHERE organization_id=$1::uuid AND is_active=TRUE ORDER BY position ASC`, [org]);
  const counts = await client.query<CountRow>(
    `SELECT e.stage_id AS stage,COUNT(DISTINCT e.customer_id)::text AS count
     FROM events e JOIN customers c ON c.organization_id=e.organization_id AND c.id=e.customer_id
     WHERE e.organization_id=$1::uuid AND c.created_at >= $2::date
       AND c.created_at < ($3::date + INTERVAL '1 day')
       AND ($4::text IS NULL OR c.channel=$4)
     GROUP BY e.stage_id`, [org,f.from,f.to,f.channel ?? null]);
  const byStage = new Map(counts.rows.map(r => [r.stage,Number(r.count)]));
  const visits = byStage.get("visit") ?? 0;
  return stages.rows.map((stage,i) => {
    const count = byStage.get(stage.id) ?? 0;
    const previous = i ? byStage.get(stages.rows[i-1]!.id) ?? 0 : count;
    return {stage:stage.id,label:stage.label,count,
      conversionFromPrevious:i===0?100:pct(count,previous),conversionFromVisit:pct(count,visits)};
  });
}

export async function getPostgresSummary(pool: Pick<Pool,"connect">, org: string, f: Filters): Promise<PostgresSummary> {
  assertTenant(org); assertFilters(f);
  return withTenantTransaction(pool,org,async client => {
    const funnel=await readFunnel(client,org,f);
    const visits=funnel.find(x=>x.stage==="visit")?.count ?? 0;
    const customers=funnel.find(x=>x.stage==="customer")?.count ?? 0;
    const leads=await client.query<{count:string}>(
      `SELECT COUNT(DISTINCT e.customer_id)::text AS count FROM events e
       JOIN customers c ON c.organization_id=e.organization_id AND c.id=e.customer_id
       WHERE e.organization_id=$1::uuid AND e.stage_id='lead'
         AND c.created_at >= $2::date AND c.created_at < ($3::date + INTERVAL '1 day')
         AND ($4::text IS NULL OR c.channel=$4)`,[org,f.from,f.to,f.channel ?? null]);
    const avg=await client.query<{days:string|null}>(
      `WITH visits AS (SELECT customer_id,MIN(occurred_at) AS at FROM events WHERE organization_id=$1::uuid AND stage_id='visit' GROUP BY customer_id),
       conversions AS (SELECT customer_id,MIN(occurred_at) AS at FROM events WHERE organization_id=$1::uuid AND stage_id='customer' GROUP BY customer_id)
       SELECT AVG(EXTRACT(EPOCH FROM (conversions.at-visits.at))/86400.0)::text AS days
       FROM visits JOIN conversions USING(customer_id)
       JOIN customers c ON c.organization_id=$1::uuid AND c.id=visits.customer_id
       WHERE c.created_at >= $2::date AND c.created_at < ($3::date + INTERVAL '1 day')
         AND ($4::text IS NULL OR c.channel=$4) AND conversions.at >= visits.at`,
      [org,f.from,f.to,f.channel ?? null]);
    const days=avg.rows[0]?.days;
    return {filters:f,funnel,kpis:{visits,leads:Number(leads.rows[0]?.count ?? "0"),customers,
      conversionRate:funnel.find(x=>x.stage==="customer")?.conversionFromVisit ?? 0,
      avgDaysToCustomer:days==null?null:Math.round(Number(days)*10)/10}};
  });
}

export async function getPostgresChannels(pool: Pick<Pool,"connect">,org:string,f:Filters):Promise<PostgresChannelRow[]> {
  assertTenant(org);assertFilters(f);
  return withTenantTransaction(pool,org,async client=>{
    const r=await client.query<{channel:string;visits:string;leads:string;customers:string}>(
      `SELECT c.channel,COUNT(DISTINCT c.id)::text AS visits,
       COUNT(DISTINCT CASE WHEN e.stage_id='lead' THEN c.id END)::text AS leads,
       COUNT(DISTINCT CASE WHEN e.stage_id='customer' THEN c.id END)::text AS customers
       FROM customers c LEFT JOIN events e ON e.organization_id=c.organization_id AND e.customer_id=c.id
       WHERE c.organization_id=$1::uuid AND c.created_at >= $2::date AND c.created_at < ($3::date + INTERVAL '1 day')
       GROUP BY c.channel`,[org,f.from,f.to]);
    return r.rows.map(x=>{const visits=Number(x.visits),leads=Number(x.leads),customers=Number(x.customers);
      return {channel:x.channel,visits,leads,customers,visitToLead:pct(leads,visits),visitToCustomer:pct(customers,visits)};
    }).sort((a,b)=>b.visitToCustomer-a.visitToCustomer);
  });
}

export async function getPostgresTimeseries(pool: Pick<Pool,"connect">,org:string,f:Filters):Promise<PostgresMonthPoint[]> {
  assertTenant(org);assertFilters(f);
  return withTenantTransaction(pool,org,async client=>{
    const r=await client.query<{month:string;visits:string;customers:string}>(
      `SELECT to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM') AS month,
       COUNT(DISTINCT c.id)::text AS visits,
       COUNT(DISTINCT CASE WHEN e.stage_id='customer' THEN c.id END)::text AS customers
       FROM customers c LEFT JOIN events e ON e.organization_id=c.organization_id AND e.customer_id=c.id
       WHERE c.organization_id=$1::uuid AND c.created_at >= $2::date AND c.created_at < ($3::date + INTERVAL '1 day')
         AND ($4::text IS NULL OR c.channel=$4)
       GROUP BY month ORDER BY month`,[org,f.from,f.to,f.channel ?? null]);
    return r.rows.map(x=>{const visits=Number(x.visits),customers=Number(x.customers);
      return {month:x.month,visits,customers,conversion:pct(customers,visits)};});
  });
}

export async function getPostgresMeta(pool: Pick<Pool,"connect">,org:string):Promise<{minDate:string|null;maxDate:string|null;channels:string[]}> {
  assertTenant(org);
  return withTenantTransaction(pool,org,async client=>{
    const r=await client.query<{minDate:string|null;maxDate:string|null}>(
      `SELECT to_char(MIN(created_at) AT TIME ZONE 'UTC','YYYY-MM-DD') AS "minDate",
       to_char(MAX(created_at) AT TIME ZONE 'UTC','YYYY-MM-DD') AS "maxDate"
       FROM customers WHERE organization_id=$1::uuid`,[org]);
    return {minDate:r.rows[0]?.minDate ?? null,maxDate:r.rows[0]?.maxDate ?? null,channels:[...CHANNELS]};
  });
}
