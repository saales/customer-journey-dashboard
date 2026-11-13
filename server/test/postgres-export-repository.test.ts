import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { exportPostgresCustomersCsv } from "../src/postgres-export-repository.js";
function mockPool(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows }));
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
    const result = await exportPostgresCustomersCsv(mock.pool, "11111111-1111-4111-8111-111111111111");
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).toContain("'+cmd");
    expect(result.csv).toContain("'@SUM");
    expect(result.csv).toContain("'-1");
    expect(mock.query.mock.calls.some(([statement]) => String(statement).includes("INSERT INTO audit_logs"))).toBe(true);
  });
});
