import { postgresPool } from "./postgres.js";
import {
  applyPostgresMigrations,
  loadPostgresMigrations,
  planPostgresMigrations,
} from "./postgres-migrations.js";

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  try {
    const migrations = await loadPostgresMigrations();

    if (checkOnly) {
      const plan = await planPostgresMigrations(postgresPool, migrations);
      console.log("Preflight migrazioni PostgreSQL (sola lettura):");
      console.log("Già applicate:", plan.applied.length ? plan.applied.join(", ") : "nessuna");
      console.log("Pendenti:", plan.pending.length ? plan.pending.join(", ") : "nessuna");
      console.log("Anomalie:", plan.drift.length ? plan.drift.join("; ") : "nessuna");
      if (plan.drift.length > 0) process.exitCode = 2;
      return;
    }

    const result = await applyPostgresMigrations(postgresPool, migrations);
    console.log("Migrazioni PostgreSQL completate.");
    console.log("Applicate:", result.applied.length ? result.applied.join(", ") : "nessuna");
    console.log("Già presenti:", result.alreadyApplied.length ? result.alreadyApplied.join(", ") : "nessuna");
  } catch (error) {
    console.error(
      checkOnly ? "Preflight PostgreSQL non riuscito:" : "Migrazioni PostgreSQL non riuscite:",
      error instanceof Error ? error.message : "Errore sconosciuto",
    );
    process.exitCode = 1;
  } finally {
    await postgresPool.end();
  }
}

void main();
