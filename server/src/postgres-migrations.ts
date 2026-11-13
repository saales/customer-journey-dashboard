import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

export interface PostgresMigration {
  version: string;
  name: string;
  sql: string;
}

interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
}

const MIGRATION_FILES = [
  "001_initial_schema.sql",
  "002_session_organization.sql",
] as const;

const MIGRATION_LOCK_ID = "731904221";

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function validateMigrations(migrations: PostgresMigration[]): void {
  const versions = new Set<string>();
  let previousVersion = "";

  for (const migration of migrations) {
    if (!/^\d{3,}$/.test(migration.version) || !migration.name.trim()) {
      throw new Error("Definizione migrazione non valida.");
    }
    if (versions.has(migration.version) || migration.version <= previousVersion) {
      throw new Error("Le migrazioni devono avere versioni uniche e ordinate.");
    }
    if (!migration.sql.trim()) {
      throw new Error(`La migrazione ${migration.version} è vuota.`);
    }
    versions.add(migration.version);
    previousVersion = migration.version;
  }
}

/**
 * Applica le migrazioni sul database indicato dal pool.
 * Ogni file è atomico, le modifiche concorrenti sono serializzate da un
 * advisory lock PostgreSQL e il checksum impedisce di riscrivere la storia.
 */
export async function applyPostgresMigrations(
  pool: Pick<Pool, "connect">,
  migrations: PostgresMigration[],
): Promise<{ applied: string[]; alreadyApplied: string[] }> {
  validateMigrations(migrations);

  const client = await pool.connect();
  let lockAcquired = false;
  let transactionStarted = false;
  let destroyClient = false;
  let failed = false;

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_ID]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await client.query<AppliedMigration>(`
      SELECT version, name, checksum
      FROM public.schema_migrations
      ORDER BY version
    `);
    const recorded = new Map(result.rows.map((row) => [row.version, row]));

    for (const migration of migrations) {
      const digest = checksum(migration.sql);
      const existing = recorded.get(migration.version);

      if (existing) {
        if (existing.name !== migration.name || existing.checksum.trim() !== digest) {
          throw new Error(
            `Checksum o nome non coerente per la migrazione ${migration.version}; ripristinare il file originale e creare una nuova migrazione.`,
          );
        }
        alreadyApplied.push(migration.version);
        continue;
      }

      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO public.schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, digest],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      applied.push(migration.version);
    }

    return { applied, alreadyApplied };
  } catch (error) {
    failed = true;
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
      }
    }
    throw error;
  } finally {
    let unlockError: unknown;
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_ID]);
      } catch (error) {
        destroyClient = true;
        unlockError = error;
      }
    }
    client.release(destroyClient);
    if (unlockError && !failed) throw unlockError;
  }
}

export async function loadPostgresMigrations(): Promise<PostgresMigration[]> {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = resolve(currentDirectory, "../migrations");

  return Promise.all(MIGRATION_FILES.map(async (file) => ({
    version: file.slice(0, 3),
    name: file,
    sql: await readFile(resolve(migrationsDirectory, file), "utf8"),
  })));
}
