import { postgresPool } from "./postgres.js";
import { inspectPostgresSchema } from "./postgres-schema-inspection.js";

async function main(): Promise<void> {
  try {
    const client = await postgresPool.connect();
    const report = await inspectPostgresSchema(client);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(
      "Ispezione PostgreSQL non riuscita:",
      error instanceof Error ? error.message : "Errore sconosciuto",
    );
    process.exitCode = 1;
  } finally {
    await postgresPool.end();
  }
}

void main();
