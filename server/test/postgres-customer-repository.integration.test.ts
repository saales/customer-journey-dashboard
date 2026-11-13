import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { listPostgresCustomers } from "../src/postgres-customer-repository.js";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL customer repository", () => {
  it.skipIf(!pool)("isola conteggi, pagine ed eventi per tenant e ripulisce il contesto locale", async () => {
    const organizationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const organizationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const client = await pool!.connect();

    try {
      await client.query(`
        CREATE TEMP TABLE customers (
          id BIGINT PRIMARY KEY,
          organization_id UUID NOT NULL,
          channel TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE events (
          id BIGINT PRIMARY KEY,
          organization_id UUID NOT NULL,
          customer_id BIGINT NOT NULL,
          stage_id TEXT NOT NULL,
          occurred_at TIMESTAMPTZ NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(
        `INSERT INTO customers (id, organization_id, channel, created_at)
         VALUES
           (101, $1, 'organic', '2026-01-02T00:00:00Z'),
           (102, $1, 'paid', '2026-01-03T00:00:00Z'),
           (201, $2, 'partner', '2026-01-04T00:00:00Z')`,
        [organizationA, organizationB],
      );
      await client.query(
        `INSERT INTO events (id, organization_id, customer_id, stage_id, occurred_at)
         VALUES
           (1001, $1, 101, 'visit', '2026-01-02T00:00:00Z'),
           (1002, $1, 101, 'lead', '2026-01-02T12:00:00Z'),
           (2001, $2, 201, 'visit', '2026-01-04T00:00:00Z')`,
        [organizationA, organizationB],
      );
    } finally {
      client.release();
    }

    const firstPage = await listPostgresCustomers(pool!, organizationA, 1, 1);
    expect(firstPage).toEqual({
      data: [{
        id: "102",
        channel: "paid",
        createdAt: "2026-01-03",
        events: [],
      }],
      pagination: { page: 1, limit: 1, total: 2, totalPages: 2 },
    });

    const secondPage = await listPostgresCustomers(pool!, organizationA, 2, 1);
    expect(secondPage.data).toEqual([{
      id: "101",
      channel: "organic",
      createdAt: "2026-01-02",
      events: [
        { stage: "visit", occurredAt: "2026-01-02" },
        { stage: "lead", occurredAt: "2026-01-02" },
      ],
    }]);

    const tenantB = await listPostgresCustomers(pool!, organizationB);
    expect(tenantB.data.map((customer) => customer.id)).toEqual(["201"]);
    expect(tenantB.pagination.total).toBe(1);

    const after = await pool!.query<{ tenant: string | null }>(
      "SELECT current_setting('app.organization_id', true) AS tenant",
    );
    expect(after.rows[0]?.tenant).not.toBe(organizationA);
    expect(after.rows[0]?.tenant).not.toBe(organizationB);
  });

  it("rejects invalid tenant identifiers and pagination before connecting", async () => {
    const invalidPool = { connect: () => { throw new Error("must not connect"); } };
    await expect(listPostgresCustomers(invalidPool, "not-a-uuid")).rejects.toThrow(
      "Identificativo organizzazione non valido.",
    );
    await expect(listPostgresCustomers(invalidPool, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0))
      .rejects.toThrow("Parametro page non valido.");
    await expect(listPostgresCustomers(invalidPool, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1, 101))
      .rejects.toThrow("Parametro limit non valido");
  });
});
