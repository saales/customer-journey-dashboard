export interface Meta {
  minDate: string;
  maxDate: string;
  channels: string[];
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
  id: number;
  channel: string;
  createdAt: string;
  events: CustomerEvent[];
}

export interface CustomerInput {
  channel: string;
  createdAt: string;
  events: CustomerEvent[];
}

export interface Query {
  from: string;
  to: string;
  channel?: string;
}

async function get<T>(path: string, params: Record<string, string | undefined>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const res = await fetch(`/api/${path}${qs.size ? `?${qs}` : ""}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Errore ${res.status}`);
  }
  return res.json() as Promise<T>;
}


async function send<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
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
  meta: (signal?: AbortSignal) => get<Meta>("meta", {}, signal),
  summary: (q: Query, signal?: AbortSignal) => get<Summary>("summary", { ...q }, signal),
  channels: (q: Query, signal?: AbortSignal) => get<ChannelRow[]>("channels", { ...q }, signal),
  timeseries: (q: Query, signal?: AbortSignal) => get<MonthPoint[]>("timeseries", { ...q }, signal),
  customers: (signal?: AbortSignal) => get<Customer[]>("customers", {}, signal),
  createCustomer: (data: CustomerInput) =>
  send<Customer>("customers", "POST", data),

updateCustomer: (id: number, data: CustomerInput) =>
  send<Customer>(`customers/${id}`, "PUT", data),

deleteCustomer: (id: number) =>
  send<void>(`customers/${id}`, "DELETE"),
};