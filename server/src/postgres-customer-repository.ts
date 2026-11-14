import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PostgresCustomerEvent {
  stage: string;
  occurredAt: string;
}

export interface PostgresCustomer {
  /** BIGINT is serialized as a string to avoid JavaScript precision loss. */
  id: string;
  channel: string;
  createdAt: string;
  events: PostgresCustomerEvent[];
}

export interface CustomerPage {
  data: PostgresCustomer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class PostgresCustomerNotFoundError extends Error {
  constructor() {
    super("Cliente non trovato.");
    this.name = "PostgresCustomerNotFoundError";
  }
}

interface CustomerRow {
  id: string;
  channel: string;
  createdAt: string;
}

interface EventRow {
  customerId: string;
  stage: string;
  occurredAt: string;
}

/**
 * Read-only tenant-scoped customer listing.
 *
 * organizationId must come from a verified server-side membership/session,
 * never from a request query/body/header. Both customer and event queries
 * carry the tenant predicate explicitly; the transaction also scopes the
 * connection-local tenant setting for future RLS policies.
 *
 * The HTTP routes pass the organization and actor from the verified session.
 */
export async function listPostgresCustomers(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  page = 1,
  limit = 50,
): Promise<CustomerPage> {
  if (!UUID_RE.test(organizationId)) {
    throw new Error("Identificativo organizzazione non valido.");
  }
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("Parametro page non valido.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Parametro limit non valido (valori ammessi: 1-100).");
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new Error("Parametro page non valido.");
  }

  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    const countResult = await client.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM customers WHERE organization_id = $1::uuid",
      [organizationId],
    );
    const total = Number(countResult.rows[0]?.total ?? "0");
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error("Conteggio clienti PostgreSQL fuori dall'intervallo sicuro.");
    }

    const customerResult = await client.query<CustomerRow>(
      `SELECT id::text AS id,
              channel,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "createdAt"
       FROM customers
       WHERE organization_id = $1::uuid
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [organizationId, limit, offset],
    );
    const customers = customerResult.rows;
    const eventsByCustomer = new Map<string, PostgresCustomerEvent[]>();

    if (customers.length > 0) {
      const ids = customers.map((customer) => customer.id);
      const eventResult = await client.query<EventRow>(
        `SELECT customer_id::text AS "customerId",
                stage_id AS stage,
                to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "occurredAt"
         FROM events
         WHERE organization_id = $1::uuid
           AND customer_id = ANY($2::bigint[])
         ORDER BY customer_id ASC, occurred_at ASC, id ASC`,
        [organizationId, ids],
      );

      for (const event of eventResult.rows) {
        const customerEvents = eventsByCustomer.get(event.customerId) ?? [];
        customerEvents.push({
          stage: event.stage,
          occurredAt: event.occurredAt,
        });
        eventsByCustomer.set(event.customerId, customerEvents);
      }
    }

    return {
      data: customers.map((customer) => ({
        ...customer,
        events: eventsByCustomer.get(customer.id) ?? [],
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });
}



async function writeCustomerAudit(
  client: PoolClient,
  organizationId: string,
  actorUserId: string | undefined,
  action: string,
  customerId: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!actorUserId) return;
  await client.query(
    "INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, details) VALUES ($1::uuid, $2::uuid, $3, 'customer', $4, $5::jsonb)",
    [organizationId, actorUserId, action, customerId, JSON.stringify(details)],
  );
}

export interface CreatePostgresCustomerInput {
  externalId: string;
  channel: string;
  createdAt: string;
  events: PostgresCustomerEvent[];
}

export interface CreatedPostgresCustomer {
  id: string;
  externalId: string;
}

/**
 * Creates a customer and its ordered journey atomically.
 * organizationId must come from a verified server-side session/membership.
 */
export async function createPostgresCustomer(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  input: CreatePostgresCustomerInput,
  actorUserId?: string,
): Promise<CreatedPostgresCustomer> {
  if (!UUID_RE.test(organizationId)) {
    throw new Error("Identificativo organizzazione non valido.");
  }
  if (actorUserId !== undefined && !UUID_RE.test(actorUserId)) {
    throw new Error("Identificativo attore non valido.");
  }
  const externalId = input.externalId.trim();
  if (!externalId || externalId.length > 100) {
    throw new Error("Identificativo cliente mancante o troppo lungo.");
  }
  if (!input.channel.trim() || input.channel.length > 100) {
    throw new Error("Canale non valido.");
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isDate = (value: string) =>
    datePattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!isDate(input.createdAt)) {
    throw new Error("Data di ingresso non valida.");
  }
  if (!Array.isArray(input.events) || input.events.length > 50) {
    throw new Error("Elenco eventi non valido.");
  }

  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    const stagesResult = await client.query<{ id: string; position: number }>(
      "SELECT id, position FROM funnel_stages WHERE organization_id = $1::uuid AND is_active = TRUE ORDER BY position ASC",
      [organizationId],
    );
    const stagePositions = new Map(stagesResult.rows.map((stage) => [stage.id, stage.position]));
    if (stagePositions.get("visit") !== 0) {
      throw new Error("Configurazione delle fasi non valida.");
    }

    let previousPosition = -1;
    let previousDate = input.createdAt;
    const seen = new Set<string>();
    if (input.events.length === 0 || input.events[0]?.stage !== "visit") {
      throw new Error("Il percorso deve iniziare con la fase visit.");
    }
    for (const event of input.events) {
      const position = stagePositions.get(event.stage);
      if (position === undefined || position <= previousPosition || seen.has(event.stage)) {
        throw new Error("Le fasi devono essere uniche e seguire l'ordine configurato.");
      }
      if (!isDate(event.occurredAt) || event.occurredAt < previousDate) {
        throw new Error("Le date degli eventi non rispettano l'ordine cronologico.");
      }
      if (event.stage === "visit" && event.occurredAt !== input.createdAt) {
        throw new Error("La fase visit deve coincidere con la data di ingresso.");
      }
      seen.add(event.stage);
      previousPosition = position;
      previousDate = event.occurredAt;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO customers (organization_id, external_id, channel, created_at)
       VALUES ($1::uuid, $2, $3, $4::date::timestamp AT TIME ZONE 'UTC')
       RETURNING id::text AS id`,
      [organizationId, externalId, input.channel, input.createdAt],
    );
    const customerId = inserted.rows[0]?.id;
    if (!customerId) throw new Error("Creazione cliente non riuscita.");

    for (const event of input.events) {
      await client.query(
        `INSERT INTO events (organization_id, customer_id, stage_id, occurred_at)
         VALUES ($1::uuid, $2::bigint, $3, $4::date::timestamp AT TIME ZONE 'UTC')`,
        [organizationId, customerId, event.stage, event.occurredAt],
      );
    }
    await writeCustomerAudit(client, organizationId, actorUserId, "customer.created", customerId, {
      channel: input.channel,
      eventCount: input.events.length,
    });

    return { id: customerId, externalId };
  });
}


export interface UpdatedPostgresCustomer {
  id: string;
  channel: string;
  createdAt: string;
  events: PostgresCustomerEvent[];
}
const CUSTOMER_ID_RE = /^[1-9]\d{0,18}$/;

/** Aggiorna dati e percorso del cliente in un'unica transazione tenant-scoped. */
export async function updatePostgresCustomer(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  customerId: string,
  input: CreatePostgresCustomerInput,
  actorUserId?: string,
): Promise<UpdatedPostgresCustomer> {
  if (!UUID_RE.test(organizationId)) throw new Error("Identificativo organizzazione non valido.");
  if (actorUserId !== undefined && !UUID_RE.test(actorUserId)) throw new Error("Identificativo attore non valido.");
  if (typeof customerId !== "string" || !CUSTOMER_ID_RE.test(customerId)) throw new Error("Identificativo cliente non valido.");
  if (!input.channel.trim() || input.channel.length > 100) throw new Error("Canale non valido.");
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!validDate(input.createdAt)) throw new Error("Data di ingresso non valida.");
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > 50 ||
      input.events[0]?.stage !== "visit" || input.events[0]?.occurredAt !== input.createdAt) {
    throw new Error("Il percorso deve iniziare con la fase visit.");
  }

  return withTenantTransaction(pool, organizationId, async (client) => {
    const current = await client.query(
      "SELECT id FROM customers WHERE organization_id=$1::uuid AND id=$2::bigint FOR UPDATE",
      [organizationId, customerId],
    );
    if (current.rowCount !== 1) throw new PostgresCustomerNotFoundError();
    const stageRows = await client.query<{id:string;position:number;is_active:boolean}>(
      "SELECT id,position,is_active FROM funnel_stages WHERE organization_id=$1::uuid ORDER BY position",
      [organizationId],
    );
    const stages = new Map(stageRows.rows.map(row=>[row.id,{position:row.position,isActive:row.is_active}]));
    if (stages.get("visit")?.position !== 0) throw new Error("Configurazione delle fasi non valida.");
    const previousEvents = await client.query<{stage_id:string;occurred_at:string}>(
      "SELECT stage_id,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS occurred_at FROM events WHERE organization_id=$1::uuid AND customer_id=$2::bigint",
      [organizationId,customerId],
    );
    const previousDates = new Map(previousEvents.rows.map(row=>[row.stage_id,row.occurred_at]));
    const seen = new Set<string>();
    let previousPosition = -1, previousDate = input.createdAt;
    for (const event of input.events) {
      const stage = stages.get(event.stage);
      const position = stage?.position;
      const inactiveStageWasAlreadyRecorded =
        stage !== undefined && !stage.isActive && previousDates.get(event.stage) === event.occurredAt;
      if (stage === undefined || position === undefined || position <= previousPosition || seen.has(event.stage) ||
          (!stage.isActive && !inactiveStageWasAlreadyRecorded) ||
          !validDate(event.occurredAt) || event.occurredAt < previousDate) {
        throw new Error("Le fasi e le date del percorso non sono valide.");
      }
      seen.add(event.stage); previousPosition = position; previousDate = event.occurredAt;
    }
    await client.query(
      "UPDATE customers SET channel=$3,created_at=$4::date::timestamp AT TIME ZONE 'UTC' WHERE organization_id=$1::uuid AND id=$2::bigint",
      [organizationId,customerId,input.channel,input.createdAt],
    );
    await client.query("DELETE FROM events WHERE organization_id=$1::uuid AND customer_id=$2::bigint",[organizationId,customerId]);
    for (const event of input.events) {
      await client.query(
        `INSERT INTO events(organization_id,customer_id,stage_id,occurred_at)
         VALUES($1::uuid,$2::bigint,$3,$4::date::timestamp AT TIME ZONE 'UTC')`,
        [organizationId,customerId,event.stage,event.occurredAt],
      );
    }
    await writeCustomerAudit(client, organizationId, actorUserId, "customer.updated", customerId, {
      channel: input.channel,
      eventCount: input.events.length,
    });
    return {id:customerId,channel:input.channel,createdAt:input.createdAt,events:input.events};
  });
}

/** Elimina un cliente solo all'interno dell'organizzazione autenticata. */
export async function deletePostgresCustomer(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  customerId: string,
  actorUserId?: string,
): Promise<void> {
  if (!UUID_RE.test(organizationId)) throw new Error("Identificativo organizzazione non valido.");
  if (actorUserId !== undefined && !UUID_RE.test(actorUserId)) throw new Error("Identificativo attore non valido.");
  if (typeof customerId !== "string" || !CUSTOMER_ID_RE.test(customerId)) throw new Error("Identificativo cliente non valido.");
  await withTenantTransaction(pool,organizationId,async client=>{
    const result=await client.query<{ id: string; channel: string }>(
      "DELETE FROM customers WHERE organization_id=$1::uuid AND id=$2::bigint RETURNING id::text AS id, channel",
      [organizationId,customerId],
    );
    const deleted = result.rows[0];
    if(!deleted) throw new PostgresCustomerNotFoundError();
    await writeCustomerAudit(client, organizationId, actorUserId, "customer.deleted", customerId, {
      channel: deleted.channel,
    });
  });
}
