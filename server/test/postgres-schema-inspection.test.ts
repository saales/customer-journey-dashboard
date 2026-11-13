import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { inspectPostgresSchema } from "../src/postgres-schema-inspection.js";

function createClientMock() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "BEGIN READ ONLY" || sql === "ROLLBACK") {
      return { rows: [] };
    }
    if (sql.includes("current_database()")) {
      return { rows: [{ database: "test_db", database_user: "app", current_schema: "public", server_version: "16" }] };
    }
    if (sql.includes("pg_catalog.pg_class")) {
      return { rows: [{ schema: "public", table: "customers", row_level_security_enabled: true, row_level_security_forced: false }] };
    }
    if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
    if (sql.includes("rolname")) return { rows: [{ role: "app", is_superuser: false, bypasses_rls: false }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  return { client, query, release };
}

describe("inspectPostgresSchema", () => {
  it("legge solo metadati in READ ONLY e rilascia il client", async () => {
    const mock = createClientMock();

    const report = await inspectPostgresSchema(mock.client);

    expect(report.database?.database).toBe("test_db");
    expect(report.tables).toEqual([
      { schema: "public", table: "customers", row_level_security_enabled: true, row_level_security_forced: false },
    ]);
    expect(report.schemaMigrationsTable?.exists).toBe(true);
    expect(report.currentRoleCapabilities?.is_superuser).toBe(false);
    expect(report.safety).toContain("READ ONLY");
    expect(mock.query.mock.calls[0][0]).toBe("BEGIN READ ONLY");
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mock.query).toHaveBeenCalledTimes(10);
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.release).toHaveBeenCalledWith(false);

    const statements = mock.query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
  });

  it("propaga un errore di lettura e completa il rollback", async () => {
    const mock = createClientMock();
    const failure = new Error("catalog unavailable");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN READ ONLY" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("current_database()")) throw failure;
      return { rows: [] };
    });

    await expect(inspectPostgresSchema(mock.client)).rejects.toBe(failure);
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("distrugge la connessione se il rollback fallisce", async () => {
    const mock = createClientMock();
    const rollbackFailure = new Error("rollback failed");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw rollbackFailure;
      if (sql === "BEGIN READ ONLY") return { rows: [] };
      if (sql.includes("current_database()")) throw new Error("read failed");
      return { rows: [] };
    });

    await expect(inspectPostgresSchema(mock.client)).rejects.toThrow("read failed");
    expect(mock.release).toHaveBeenCalledWith(true);
  });

  it("rilascia il client se BEGIN fallisce senza tentare rollback", async () => {
    const mock = createClientMock();
    const failure = new Error("read only not supported");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN READ ONLY") throw failure;
      return { rows: [] };
    });

    await expect(inspectPostgresSchema(mock.client)).rejects.toBe(failure);
    expect(mock.query).toHaveBeenCalledOnce();
    expect(mock.release).toHaveBeenCalledWith(false);
  });
});
