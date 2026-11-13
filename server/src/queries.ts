
import type { Db } from "./db.js";
import { CHANNELS, type Filters } from "./types.js";

/**
 * Tutte le analisi lavorano per coorte: si considerano i clienti la cui prima visita
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

const pct = (num: number, den: number) =>
  den === 0 ? 0 : Math.round((num / den) * 1000) / 10;

export interface FunnelStep {
  stage: string;
  label: string;
  count: number;
  conversionFromPrevious: number;
  conversionFromVisit: number;
}

export function getFunnel(db: Db, f: Filters): FunnelStep[] {
  const { sql, params } = cohortWhere(f, true);

  const stages = db
    .prepare(`
      SELECT id, label
      FROM funnel_stages
      WHERE is_active = 1
      ORDER BY position ASC
    `)
    .all() as { id: string; label: string }[];

  const rows = db
    .prepare(
      `SELECT e.stage AS stage, COUNT(DISTINCT e.customer_id) AS count
       FROM events e
       JOIN customers c ON c.id = e.customer_id
       WHERE ${sql}
       GROUP BY e.stage`,
    )
    .all(params) as { stage: string; count: number }[];

  const counts = new Map(rows.map((r) => [r.stage, r.count]));
  const visits = counts.get("visit") ?? 0;

  return stages.map((stage, i) => {
    const count = counts.get(stage.id) ?? 0;
    const previousStage = stages[i - 1];
    const previousCount = previousStage
      ? counts.get(previousStage.id) ?? 0
      : count;

    return {
      stage: stage.id,
      label: stage.label,
      count,
      conversionFromPrevious: i === 0 ? 100 : pct(count, previousCount),
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
              COUNT(DISTINCT CASE WHEN e.stage = 'lead' THEN c.id END) AS leads,
              COUNT(DISTINCT CASE WHEN e.stage = 'customer' THEN c.id END) AS customers
       FROM customers c
       JOIN events e ON e.customer_id = c.id
       WHERE ${sql}
       GROUP BY c.channel`,
    )
    .all(params) as {
      channel: string;
      visits: number;
      leads: number;
      customers: number;
    }[];

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
    .all(params) as {
      month: string;
      visits: number;
      customers: number;
    }[];

  return rows.map((r) => ({
    ...r,
    conversion: pct(r.customers, r.visits),
  }));
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
  const row = db
    .prepare(
      "SELECT MIN(created_at) AS minDate, MAX(created_at) AS maxDate FROM customers",
    )
    .get() as {
      minDate: string | null;
      maxDate: string | null;
    };

  return {
    minDate: row.minDate,
    maxDate: row.maxDate,
    channels: [...CHANNELS],
  };
}

/* -------------------------------------------------------------------------- */
/* Segmentazione                                                              */
/* -------------------------------------------------------------------------- */

export interface SegmentRow {
  id: string;
  label: string;
  customers: number;
  share: number;
  conversionRate: number;
}

export interface SegmentAnalysis {
  totalCustomers: number;
  channels: SegmentRow[];
  stages: SegmentRow[];
  periods: SegmentRow[];
  combinations: SegmentRow[];
}

export interface SegmentCustomer {
  id: number;
  channel: string;
  createdAt: string;
  stage: string;
  stageLabel: string;
  stageActive: boolean;
}

/**
 * Restituisce un solo record per cliente, relativo alla fase più avanzata
 * effettivamente raggiunta.
 *
 * La posizione considera tutte le fasi configurate, anche quelle disattivate.
 * Gli eventi associati a fasi non più presenti nella configurazione vengono
 * comunque mantenuti e classificati come fase disattivata.
 */
function getLatestStageCustomers(db: Db, f: Filters): SegmentCustomer[] {
  const { sql, params } = cohortWhere(f, true);

  const rows = db
    .prepare(`
      WITH ranked_events AS (
        SELECT
          c.id AS id,
          c.channel AS channel,
          c.created_at AS createdAt,
          e.stage AS stage,
          fs.label AS stageLabel,
          fs.is_active AS stageActive,
          fs.position AS stagePosition,
          ROW_NUMBER() OVER (
            PARTITION BY c.id
            ORDER BY
              CASE WHEN fs.id IS NULL THEN -1 ELSE fs.position END DESC,
              e.occurred_at DESC,
              e.id DESC
          ) AS rowNumber
        FROM customers c
        JOIN events e ON e.customer_id = c.id
        LEFT JOIN funnel_stages fs ON fs.id = e.stage
        WHERE ${sql}
      )
      SELECT
        id,
        channel,
        createdAt,
        stage,
        COALESCE(stageLabel, 'Fase non configurata') AS stageLabel,
        COALESCE(stageActive, 0) AS stageActive
      FROM ranked_events
      WHERE rowNumber = 1
      ORDER BY id DESC
    `)
    .all(params) as {
      id: number;
      channel: string;
      createdAt: string;
      stage: string;
      stageLabel: string;
      stageActive: number;
    }[];

  return rows.map((customer) => ({
    ...customer,
    stageActive: customer.stageActive === 1,
  }));
}

function getStageBucket(customer: SegmentCustomer): string {
  return customer.stageActive ? customer.stage : "inactive";
}

function getStageBucketLabel(customer: SegmentCustomer): string {
  return customer.stageActive
    ? customer.stageLabel
    : "Fase disattivata";
}

function buildSegmentRows(
  customers: SegmentCustomer[],
  getKey: (customer: SegmentCustomer) => string,
  getLabel: (customer: SegmentCustomer) => string,
  total: number,
): SegmentRow[] {
  const groups = new Map<
    string,
    { label: string; customers: number; converted: number }
  >();

  for (const customer of customers) {
    const id = getKey(customer);
    const existing = groups.get(id);

    if (existing) {
      existing.customers++;

      if (customer.stage === "customer") {
        existing.converted++;
      }
    } else {
      groups.set(id, {
        label: getLabel(customer),
        customers: 1,
        converted: customer.stage === "customer" ? 1 : 0,
      });
    }
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      label: group.label,
      customers: group.customers,
      share: pct(group.customers, total),
      conversionRate: pct(group.converted, group.customers),
    }))
    .sort((a, b) => b.customers - a.customers);
}

/**
 * Calcola le statistiche di segmentazione sulla coorte selezionata.
 *
 * Il filtro canale, se presente, restringe la popolazione analizzata.
 * Le fasi disattivate e non configurate vengono aggregate in un unico
 * segmento dedicato.
 */
export function getSegments(db: Db, f: Filters): SegmentAnalysis {
  const customers = getLatestStageCustomers(db, f);
  const totalCustomers = customers.length;

  const channels = buildSegmentRows(
    customers,
    (customer) => customer.channel,
    (customer) => customer.channel,
    totalCustomers,
  );

  const stages = buildSegmentRows(
    customers,
    getStageBucket,
    getStageBucketLabel,
    totalCustomers,
  );

  const periods = buildSegmentRows(
    customers,
    (customer) => customer.createdAt.slice(0, 7),
    (customer) => customer.createdAt.slice(0, 7),
    totalCustomers,
  );

  const combinations = buildSegmentRows(
    customers,
    (customer) =>
      `${encodeURIComponent(customer.channel)}~${encodeURIComponent(getStageBucket(customer))}`,
    (customer) =>
      `${customer.channel} · ${getStageBucketLabel(customer)}`,
    totalCustomers,
  );

  return {
    totalCustomers,
    channels,
    stages,
    periods,
    combinations,
  };
}

export type SegmentDimension =
  | "channel"
  | "stage"
  | "period"
  | "combination";

/**
 * Restituisce i clienti appartenenti a un segmento.
 *
 * Per i segmenti combinati, segmentId usa il formato:
 * canale codificato ~ fase codificata.
 */
export function getSegmentCustomers(
  db: Db,
  f: Filters,
  dimension: SegmentDimension,
  segmentId: string,
): SegmentCustomer[] {
  const customers = getLatestStageCustomers(db, f);

  switch (dimension) {
    case "channel":
      return customers.filter(
        (customer) => customer.channel === segmentId,
      );

    case "stage":
      return customers.filter(
        (customer) => getStageBucket(customer) === segmentId,
      );

    case "period":
      return customers.filter(
        (customer) => customer.createdAt.slice(0, 7) === segmentId,
      );

    case "combination": {
      const separator = segmentId.indexOf("~");

      if (separator === -1) {
        return [];
      }

      let channel: string;
      let stage: string;

      try {
        channel = decodeURIComponent(segmentId.slice(0, separator));
        stage = decodeURIComponent(segmentId.slice(separator + 1));
      } catch {
        return [];
      }

      return customers.filter(
        (customer) =>
          customer.channel === channel &&
          getStageBucket(customer) === stage,
      );
    }
  }
}
