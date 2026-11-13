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
 * This repository is deliberately not wired into Express until authentication
 * and membership authorization provide a trusted organization context.
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
