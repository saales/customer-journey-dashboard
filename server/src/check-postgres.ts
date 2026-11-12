
import {
  postgresPool,
  verifyPostgresConnection,
} from "./postgres.js";

async function main(): Promise<void> {
  try {
    await verifyPostgresConnection();

    const result = await postgresPool.query(`
      SELECT
        current_database() AS database,
        current_user AS database_user,
        NOW() AS server_time
    `);

    console.log("Verifica PostgreSQL completata.");
    console.log("Database:", result.rows[0].database);
    console.log("Utente:", result.rows[0].database_user);
    console.log("Ora server:", result.rows[0].server_time);
  } catch (error) {
    console.error(
      "Connessione PostgreSQL non riuscita:",
      error instanceof Error ? error.message : "Errore sconosciuto"
    );

    process.exitCode = 1;
  } finally {
    await postgresPool.end();
  }
}

void main();
