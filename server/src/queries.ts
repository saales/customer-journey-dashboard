import type { Db } from "./db.js";
import { CHANNELS, STAGES, STAGE_LABELS, type Filters, type Stage } from "./types.js";

/**
 * Tutte le analisi lavorano per "coorte": si considerano i clienti la cui prima visita
 * cade nel periodo scelto e si seguono i loro eventi lungo il funnel.
 */
function cohortWhere(f: Filters, withChannel: boolean) {
  const params: Record<string, string> = { from: f.from, to: f.to };
  let sql = "c.created_at BETWEEN @from AND @to";
  if (withChannel && f.channel) {
    sql += " AND c.channel = @channel";
    params.channel = f.channel;
  }
  return { sql, params };
}

const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

export interface FunnelStep {
  stage: Stage;
  label: string;
  count: number;
  /** % rispetto allo stadio precedente */
  conversionFromPrevious: number;
  /** % rispetto alle visite */
  conversionFromVisit: number;
}

export function getFunnel(db: Db, f: Filters): FunnelStep[] {
  const { sql, params } = cohortWhere(f, true);
  const rows = db
    .prepare(
      `SELECT e.stage AS stage, COUNT(DISTINCT e.customer_id) AS count
       FROM events e
       JOIN customers c ON c.id = e.customer_id
       WHERE ${sql}
       GROUP BY e.stage`,
    )
    .all(params) as { stage: Stage; count: number }[];

  const counts = new Map(rows.map((r) => [r.stage, r.count]));
  const visits = counts.get("visit") ?? 0;

  return STAGES.map((stage, i) => {
    const count = counts.get(stage) ?? 0;
    const prev = i === 0 ? count : (counts.get(STAGES[i - 1]) ?? 0);
    return {
      stage,
      label: STAGE_LABELS[stage],
      count,
      conversionFromPrevious: i === 0 ? 100 : pct(count, prev),
      conversionFromVisit: pct(count, visits),
    };
  });
}

export interface ChannelRow {
  channel: string;
  visits: number;
  leads: number;
  customers: number;
  visitToLead: number;
  visitToCustomer: number;
}

/** Confronto tra canali: il filtro per canale non si applica, solo il periodo. */
export function getChannels(db: Db, f: Filters): ChannelRow[] {
  const { sql, params } = cohortWhere(f, false);
  const rows = db
    .prepare(
      `SELECT c.channel AS channel,
              COUNT(DISTINCT c.id) AS visits,
              COUNT(DISTINCT CASE WHEN e.stage = 'lead'     THEN c.id END) AS leads,
              COUNT(DISTINCT CASE WHEN e.stage = 'customer' THEN c.id END) AS customers
       FROM customers c
       JOIN events e ON e.customer_id = c.id
       WHERE ${sql}
       GROUP BY c.channel`,
    )
    .all(params) as { channel: string; visits: number; leads: number; customers: number }[];

  return rows
    .map((r) => ({
      ...r,
      visitToLead: pct(r.leads, r.visits),
      visitToCustomer: pct(r.customers, r.visits),
    }))
    .sort((a, b) => b.visitToCustomer - a.visitToCustomer);
}

export interface MonthPoint {
  month: string;
  visits: number;
  customers: number;
  conversion: number;
}

export function getTimeseries(db: Db, f: Filters): MonthPoint[] {
  const { sql, params } = cohortWhere(f, true);
  const rows = db
    .prepare(
      `SELECT substr(c.created_at, 1, 7) AS month,
              COUNT(DISTINCT c.id) AS visits,
              COUNT(DISTINCT CASE WHEN e.stage = 'customer' THEN c.id END) AS customers
       FROM customers c
       JOIN events e ON e.customer_id = c.id
       WHERE ${sql}
       GROUP BY month
       ORDER BY month`,
    )
    .all(params) as { month: string; visits: number; customers: number }[];

  return rows.map((r) => ({ ...r, conversion: pct(r.customers, r.visits) }));
}

/** Giorni medi tra la prima visita e l'acquisto, solo per chi è diventato cliente. */
export function getAvgDaysToCustomer(db: Db, f: Filters): number | null {
  const { sql, params } = cohortWhere(f, true);
  const row = db
    .prepare(
      `SELECT AVG(julianday(cu.occurred_at) - julianday(v.occurred_at)) AS days
       FROM events v
       JOIN events cu ON cu.customer_id = v.customer_id AND cu.stage = 'customer'
       JOIN customers c ON c.id = v.customer_id
       WHERE v.stage = 'visit' AND ${sql}`,
    )
    .get(params) as { days: number | null };
  return row.days === null ? null : Math.round(row.days * 10) / 10;
}

export function getMeta(db: Db) {
  const row = db.prepare("SELECT MIN(created_at) AS minDate, MAX(created_at) AS maxDate FROM customers").get() as {
    minDate: string | null;
    maxDate: string | null;
  };
  return { minDate: row.minDate, maxDate: row.maxDate, channels: [...CHANNELS] };
}
