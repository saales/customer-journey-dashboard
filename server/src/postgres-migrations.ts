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
  "003_saas_tenant_hardening.sql",
  "004_login_attempt_limits.sql",
  "005_runtime_role_grants.sql",
  "006_session_idle_timeout.sql",
  "007_membership_management.sql",
  "008_invitations_tenant_rls.sql",
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

export interface PostgresMigrationPlan {
  applied: string[];
  pending: string[];
  drift: string[];
}

/**
 * Confronta file e storico migrazioni senza eseguire DDL o scrivere dati.
 * La transazione READ ONLY rende questo controllo adatto a un preflight.
 */
export async function planPostgresMigrations(
  pool: Pick<Pool, "connect">,
  migrations: PostgresMigration[],
): Promise<PostgresMigrationPlan> {
  validateMigrations(migrations);
  const client = await pool.connect();
  let transactionOpen = false;
  let destroyClient = false;
  let failure: unknown;
  let plan: PostgresMigrationPlan | undefined;

  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    const existence = await client.query<{ migration_table_exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS migration_table_exists",
    );
    const recorded = new Map<string, AppliedMigration>();

    if (existence.rows[0]?.migration_table_exists) {
      const result = await client.query<AppliedMigration>(`
        SELECT version, name, checksum
        FROM public.schema_migrations
        ORDER BY version
      `);
      for (const row of result.rows) recorded.set(row.version, row);
    }

    const knownVersions = new Set(migrations.map((migration) => migration.version));
    const drift: string[] = [];
    const applied: string[] = [];
    const pending: string[] = [];

    for (const row of recorded.values()) {
      if (!knownVersions.has(row.version)) {
        drift.push(`Versione registrata non presente nei file: ${row.version}`);
      }
    }

    let encounteredPending = false;
    for (const migration of migrations) {
      const row = recorded.get(migration.version);
      if (!row) {
        encounteredPending = true;
        pending.push(migration.version);
        continue;
      }

      if (encounteredPending) {
        drift.push(`Storico non contiguo: ${migration.version} risulta applicata dopo una versione mancante`);
      }
      if (row.name !== migration.name || row.checksum.trim() !== checksum(migration.sql)) {
        drift.push(`Nome o checksum non coerente per la versione ${migration.version}`);
      } else {
        applied.push(migration.version);
      }
    }

    plan = { applied, pending, drift };
  } catch (error) {
    failure = error;
  } finally {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (error) {
        destroyClient = true;
        if (failure === undefined) failure = error;
      }
    }
    client.release(destroyClient);
  }

  if (failure !== undefined) throw failure;
  if (!plan) throw new Error("Piano migrazioni senza risultato.");
  return plan;
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
    const knownVersions = new Set(migrations.map((migration) => migration.version));
    for (const version of recorded.keys()) {
      if (!knownVersions.has(version)) {
        throw new Error(`Versione già registrata ma assente dai file di migrazione: ${version}. Verificare lo storico prima di procedere.`);
      }
    }

    let encounteredPending = false;
    for (const migration of migrations) {
      const wasRecorded = recorded.has(migration.version);
      if (!wasRecorded) encounteredPending = true;
      else if (encounteredPending) {
        throw new Error(`Storico migrazioni non contiguo alla versione ${migration.version}; eseguire il preflight e correggere lo storico prima di procedere.`);
      }
    }

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
      await client.query("SET LOCAL search_path TO public");
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
