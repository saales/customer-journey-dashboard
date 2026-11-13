
export interface Meta {
  minDate: string | null;
  maxDate: string | null;
  channels: string[];
}

export interface FunnelStage {
  id: string;
  label: string;
  position: number;
  isActive: boolean;
  isSystem: boolean;
}

export interface FunnelStep {
  stage: string;
  label: string;
  count: number;
  conversionFromPrevious: number;
  conversionFromVisit: number;
}

export interface Summary {
  funnel: FunnelStep[];
  kpis: {
    visits: number;
    leads: number;
    customers: number;
    conversionRate: number;
    avgDaysToCustomer: number | null;
  };
}

export interface ChannelRow {
  channel: string;
  visits: number;
  leads: number;
  customers: number;
  visitToLead: number;
  visitToCustomer: number;
}

export interface MonthPoint {
  month: string;
  visits: number;
  customers: number;
  conversion: number;
}

export interface CustomerEvent {
  stage: string;
  occurredAt: string;
}

export interface Customer {
  id: string;
  channel: string;
  createdAt: string;
  events: CustomerEvent[];
}

export interface CustomerInput {
  channel: string;
  createdAt: string;
  events: CustomerEvent[];
}

export interface CustomerPage {
  data: Customer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ImportRow {
  externalId: string;
  channel: string;
  createdAt: string;
  stage: string;
  occurredAt: string;
}

export interface ImportResult {
  message: string;
  batchId: string | number;
  importedCustomers: number;
  importedRows: number;
  importedEvents: number;
}

export interface OrganizationMember {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  role: "admin" | "editor" | "analyst" | "viewer";
  status: "active" | "suspended";
  joinedAt: string;
}

export interface Query {
  from: string;
  to: string;
  channel?: string;
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
  id: string;
  channel: string;
  createdAt: string;
  stage: string;
  stageLabel: string;
  stageActive: boolean;
}

export type SegmentDimension =
  | "channel"
  | "stage"
  | "period"
  | "combination";

export interface SegmentQuery extends Query {
  dimension: SegmentDimension;
  id: string;
}

async function get<T>(
  path: string,
  params: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }

  const res = await fetch(`/api/${path}${qs.size ? `?${qs}` : ""}`, {
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Errore ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function send<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Errore ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  members: (signal?: AbortSignal) => get<OrganizationMember[]>("members", {}, signal),

  updateMember: (id: string, data: { role?: OrganizationMember["role"]; status?: OrganizationMember["status"] }) =>
    send<OrganizationMember>(`members/${id}`, "PATCH", data),

  meta: (signal?: AbortSignal) =>
    get<Meta>("meta", {}, signal),

  funnelStages: (signal?: AbortSignal) =>
    get<FunnelStage[]>("funnel-stages", {}, signal),

  createFunnelStage: (label: string) =>
    send<FunnelStage>("funnel-stages", "POST", { label }),

  updateFunnelStage: (
    id: string,
    data: { label?: string; isActive?: boolean },
  ) =>
    send<FunnelStage>(`funnel-stages/${id}`, "PUT", data),

  reorderFunnelStages: (stages: string[]) =>
    send<FunnelStage[]>("funnel-stages/reorder", "PUT", { stages }),

  summary: (q: Query, signal?: AbortSignal) =>
    get<Summary>("summary", { ...q }, signal),

  channels: (q: Query, signal?: AbortSignal) =>
    get<ChannelRow[]>("channels", { ...q }, signal),

  timeseries: (q: Query, signal?: AbortSignal) =>
    get<MonthPoint[]>("timeseries", { ...q }, signal),

  /* Segmentazione */

  segments: (q: Query, signal?: AbortSignal) =>
    get<SegmentAnalysis>("segments", { ...q }, signal),

  segmentCustomers: (
    q: SegmentQuery,
    signal?: AbortSignal,
  ) =>
    get<SegmentCustomer[]>(
      "segments/customers",
      {
        from: q.from,
        to: q.to,
        channel: q.channel,
        dimension: q.dimension,
        id: q.id,
      },
      signal,
    ),

  customers: (page = 1, limit = 50, signal?: AbortSignal) =>
    get<CustomerPage>(
      "customers",
      { page: String(page), limit: String(limit) },
      signal,
    ),

  createCustomer: (data: CustomerInput) =>
    send<Customer>("customers", "POST", data),

  updateCustomer: (id: string, data: CustomerInput) =>
    send<Customer>(`customers/${id}`, "PUT", data),

  deleteCustomer: (id: string) =>
    send<void>(`customers/${id}`, "DELETE"),

  importCsv: (fileName: string, rows: ImportRow[]) =>
    send<ImportResult>("import", "POST", { fileName, rows }),
};
