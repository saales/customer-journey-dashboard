import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  applyPostgresMigrations,
  type PostgresMigration,
} from "../src/postgres-migrations.js";

function setup(existing: Array<{ version: string; name: string; checksum: string }> = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM public.schema_migrations")) return { rows: existing };
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) };
  return { pool, client, query, release };
}

const migrations: PostgresMigration[] = [
  { version: "001", name: "001_initial.sql", sql: "CREATE TABLE example (id integer);" },
  { version: "002", name: "002_more.sql", sql: "ALTER TABLE example ADD COLUMN label text;" },
];

describe("applyPostgresMigrations", () => {
  it("serializza e applica ogni migrazione in una transazione, registrando il checksum", async () => {
    const mock = setup();

    const result = await applyPostgresMigrations(mock.pool, migrations);

    expect(result).toEqual({ applied: ["001", "002"], alreadyApplied: [] });
    expect(mock.query.mock.calls[0][0]).toContain("pg_advisory_lock");
    expect(mock.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(true);
    expect(mock.query.mock.calls.some(([sql]) => sql.includes("CREATE TABLE example"))).toBe(true);
    expect(mock.query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(2);
    expect(mock.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO public.schema_migrations"))).toHaveLength(2);
    expect(mock.query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("non riapplica migrazioni già registrate con checksum identico", async () => {
    const { createHash } = await import("node:crypto");
    const existing = migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      checksum: createHash("sha256").update(migration.sql, "utf8").digest("hex"),
    }));
    const mock = setup(existing);

    const result = await applyPostgresMigrations(mock.pool, migrations);

    expect(result).toEqual({ applied: [], alreadyApplied: ["001", "002"] });
    expect(mock.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
  });

  it("rifiuta una migrazione modificata dopo l'applicazione", async () => {
    const mock = setup([{ version: "001", name: "001_initial.sql", checksum: "0".repeat(64) }]);

    await expect(applyPostgresMigrations(mock.pool, migrations)).rejects.toThrow(/Checksum/);
    expect(mock.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("esegue rollback e preserva l'errore originale se una migrazione fallisce", async () => {
    const mock = setup();
    const failure = new Error("DDL failed");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.schema_migrations")) return { rows: [] };
      if (sql.includes("CREATE TABLE example")) throw failure;
      return { rows: [] };
    });

    await expect(applyPostgresMigrations(mock.pool, migrations)).rejects.toBe(failure);
    expect(mock.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("distrugge il client se il rollback fallisce", async () => {
    const mock = setup();
    mock.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.schema_migrations")) return { rows: [] };
      if (sql.includes("CREATE TABLE example")) throw new Error("DDL failed");
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return { rows: [] };
    });

    await expect(applyPostgresMigrations(mock.pool, migrations)).rejects.toThrow("DDL failed");
    expect(mock.release).toHaveBeenCalledWith(true);
  });

  it("rifiuta versioni duplicate o fuori ordine prima di aprire una connessione", async () => {
    const mock = setup();

    await expect(applyPostgresMigrations(mock.pool, [migrations[1], migrations[0]])).rejects.toThrow(/ordinate/);
    expect(mock.pool.connect).not.toHaveBeenCalled();
  });
});
