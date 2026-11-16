import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  applyPostgresMigrations,
  planPostgresMigrations,
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


  it("rifiuta versioni registrate non più presenti nei file prima di applicare DDL", async () => {
    const mock = setup([{ version: "999", name: "999_removed.sql", checksum: "0".repeat(64) }]);

    await expect(applyPostgresMigrations(mock.pool, migrations)).rejects.toThrow(/assente dai file/);
    expect(mock.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
  });

  it("rifiuta uno storico applicato non contiguo prima di applicare DDL", async () => {
    const { createHash } = await import("node:crypto");
    const mock = setup([{
      version: "002",
      name: migrations[1].name,
      checksum: createHash("sha256").update(migrations[1].sql, "utf8").digest("hex"),
    }]);

    await expect(applyPostgresMigrations(mock.pool, migrations)).rejects.toThrow(/non contiguo/);
    expect(mock.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
  });

  it("rifiuta versioni duplicate o fuori ordine prima di aprire una connessione", async () => {
    const mock = setup();

    await expect(applyPostgresMigrations(mock.pool, [migrations[1], migrations[0]])).rejects.toThrow(/ordinate/);
    expect(mock.pool.connect).not.toHaveBeenCalled();
  });
});

describe("planPostgresMigrations", () => {
  it("elenca le migrazioni pendenti senza scritture", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ migration_table_exists: false }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };

    const plan = await planPostgresMigrations(pool, migrations);

    expect(plan).toEqual({ applied: [], pending: ["001", "002"], drift: [] });
    expect(query.mock.calls[0][0]).toBe("BEGIN READ ONLY");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledWith(false);
  });

  it("rileva checksum alterati e versioni sconosciute nello storico", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ migration_table_exists: true }] };
      if (sql.includes("FROM public.schema_migrations")) {
        return { rows: [
          { version: "001", name: "001_initial.sql", checksum: "0".repeat(64) },
          { version: "999", name: "999_removed.sql", checksum: "1".repeat(64) },
        ] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };

    const plan = await planPostgresMigrations(pool, migrations);

    expect(plan.applied).toEqual([]);
    expect(plan.pending).toEqual(["002"]);
    expect(plan.drift).toHaveLength(2);
    expect(plan.drift.join(" ")).toContain("001");
    expect(plan.drift.join(" ")).toContain("999");
  });

  it("rileva uno storico non contiguo", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ migration_table_exists: true }] };
      if (sql.includes("FROM public.schema_migrations")) {
        const { createHash } = await import("node:crypto");
        return { rows: [{
          version: "002",
          name: migrations[1].name,
          checksum: createHash("sha256").update(migrations[1].sql, "utf8").digest("hex"),
        }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };

    const plan = await planPostgresMigrations(pool, migrations);

    expect(plan.pending).toEqual(["001"]);
    expect(plan.drift.join(" ")).toContain("Storico non contiguo");
  });
});
