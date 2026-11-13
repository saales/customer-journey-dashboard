import {
  postgresPool,
} from "./postgres.js";
import {
  applyPostgresMigrations,
  loadPostgresMigrations,
} from "./postgres-migrations.js";

async function main(): Promise<void> {
  try {
    const migrations = await loadPostgresMigrations();
    const result = await applyPostgresMigrations(postgresPool, migrations);

    console.log("Migrazioni PostgreSQL completate.");
    console.log("Applicate:", result.applied.length ? result.applied.join(", ") : "nessuna");
    console.log("Già presenti:", result.alreadyApplied.length ? result.alreadyApplied.join(", ") : "nessuna");
  } catch (error) {
    console.error(
      "Migrazioni PostgreSQL non riuscite:",
      error instanceof Error ? error.message : "Errore sconosciuto",
    );
    process.exitCode = 1;
  } finally {
    await postgresPool.end();
  }
}

void main();
