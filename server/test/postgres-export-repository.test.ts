import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { exportPostgresCustomersCsv, exportPostgresOrganizationJson } from "../src/postgres-export-repository.js";
function mockPool(rows: unknown[]) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes("COUNT(*)") ? [{ rowCount: rows.length }] : rows }));
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
  return { pool, query };
}
describe("exportPostgresCustomersCsv", () => {
  it("genera CSV tenant-scoped con intestazioni e BOM UTF-8", async () => {
    const mock = mockPool([{ id:"12", externalId:"cust-12", channel:"Email", createdAt:"2026-10-01", stage:"lead", occurredAt:"2026-10-02" }]);
    const result = await exportPostgresCustomersCsv(mock.pool, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    expect(result.rowCount).toBe(1);
    expect(result.csv.startsWith("\uFEFF")).toBe(true);
    expect(result.csv).toContain('"ID cliente";"Identificativo esterno";"Canale"');
    expect(result.csv).toContain('"12";"cust-12";"Email";"2026-10-01";"lead";"2026-10-02"');
    const sql = String(mock.query.mock.calls.find(([statement]) => String(statement).includes("FROM customers"))?.[0]);
    expect(sql).toContain("c.organization_id = $1::uuid");
    expect(sql).toContain("LIMIT $2");
    const audit = mock.query.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO audit_logs"));
    expect(audit?.[0]).toContain("'data.exported'");
    expect(audit?.[1]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      JSON.stringify({ rowCount: 1, format: "csv" }),
    ]);
  });
  it("neutralizza valori interpretabili come formule nei fogli di calcolo", async () => {
    const mock = mockPool([{ id:"2", externalId:"=HYPERLINK", channel:"+cmd", createdAt:"2026-01-01", stage:"@SUM", occurredAt:"-1" }]);
    const result = await exportPostgresCustomersCsv(mock.pool, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).toContain("'+cmd");
    expect(result.csv).toContain("'@SUM");
    expect(result.csv).toContain("'-1");
    expect(mock.query.mock.calls.some(([statement]) => String(statement).includes("INSERT INTO audit_logs"))).toBe(true);
  });
  it("rifiuta il CSV quando il join completo supera il limite, senza troncare gli eventi", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("COUNT(*)")
      ? { rows: [{ rowCount: 100_001 }] }
      : { rows: [] });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(exportPostgresCustomersCsv(pool, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"))
      .rejects.toMatchObject({ status: 413 });
    expect(query).toHaveBeenCalledTimes(4);
  });
  it("esporta i dati organizzativi completi senza includere segreti", async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("FROM organizations")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Azienda Demo", slug: "azienda-demo", createdAt: "2026-01-01T00:00:00Z" }] };
        if (sql.includes("FROM funnel_stages")) return { rows: [{ id: "visit", label: "Visita", position: 0, isActive: true, isSystem: true }] };
        if (sql.includes("FROM customers")) return { rows: [
          { id: "5", externalId: "crm-5", channel: "Email", createdAt: "2026-01-02T00:00:00Z" },
        ] };
        if (sql.includes("FROM events")) return { rows: [
          { customerId: "5", stage: "visit", occurredAt: "2026-01-02T00:00:00Z" },
          { customerId: "5", stage: "lead", occurredAt: "2026-01-03T00:00:00Z" },
        ] };
        if (sql.includes("FROM import_batches")) return { rows: [{ id: "7", fileName: "import.csv", fingerprint: "safe-fingerprint", customerCount: 1, rowCount: 2, importedBy: null, importedAt: "2026-01-04T00:00:00Z" }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    const result = await exportPostgresOrganizationJson(pool, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    expect(result.organization.name).toBe("Azienda Demo");
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]?.events.map(event => event.stage)).toEqual(["visit", "lead"]);
    expect(result.importBatches[0]?.fileName).toBe("import.csv");
    expect(JSON.stringify(result)).not.toMatch(/password_hash|token_hash|secret|session/i);
    const customerQuery = calls.find(call => call.sql.includes("FROM customers"));
    expect(customerQuery?.sql).toContain("c.organization_id = $1::uuid");
    expect(customerQuery?.sql).toContain("LIMIT $2");
    expect(customerQuery?.values).toEqual(["11111111-1111-4111-8111-111111111111", 100_001]);
    const eventQuery = calls.find(call => call.sql.includes("FROM events"));
    expect(eventQuery?.sql).toContain("e.organization_id = $1::uuid");
    expect(eventQuery?.sql).toContain("LIMIT $2");
    expect(eventQuery?.values).toEqual(["11111111-1111-4111-8111-111111111111", 100_001]);
    const audit = calls.find(call => call.sql.includes("INSERT INTO audit_logs"));
    expect(audit?.sql).toContain("'data.exported'");
    expect(audit?.values?.[2]).toContain('"format":"json"');
  });

  it("rifiuta il JSON se un singolo cliente supera il limite di eventi", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM organizations")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Azienda", slug: "azienda", createdAt: "2026-01-01T00:00:00Z" }] };
        if (sql.includes("FROM funnel_stages")) return { rows: [] };
        if (sql.includes("FROM customers")) return { rows: [
          { id: "1", externalId: "crm-1", channel: "Email", createdAt: "2026-01-01T00:00:00Z" },
        ] };
        if (sql.includes("FROM events")) return { rows: Array.from({ length: 100_001 }, (_, index) => ({
          customerId: "1", stage: "visit", occurredAt: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}Z`,
        })) };
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(exportPostgresOrganizationJson(pool, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"))
      .rejects.toMatchObject({ status: 413 });
  });

  it("rifiuta esportazioni organizzative oltre il limite di righe", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM organizations")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Azienda", slug: "azienda", createdAt: "2026-01-01T00:00:00Z" }] };
        if (sql.includes("FROM funnel_stages")) return { rows: [] };
        if (sql.includes("FROM customers")) return { rows: Array.from({ length: 100_001 }, (_, index) => ({
          id: String(index + 1), externalId: `ext-${index}`, channel: "Email", createdAt: "2026-01-01T00:00:00Z",
        })) };
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(exportPostgresOrganizationJson(pool, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"))
      .rejects.toMatchObject({ status: 413 });
  });

});