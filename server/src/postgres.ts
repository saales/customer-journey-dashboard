
import { Pool } from "pg";
import { verifyPostgresPool } from "./postgres-health.js";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Individua la cartella principale del repository.
// Funziona sia da src/ sia da dist/.
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, "../../");

// In sviluppo carica .env.local oppure .env.
// In produzione utilizza le variabili configurate nell'ambiente.
const localEnv = resolve(projectRoot, ".env.local");
const fallbackEnv = resolve(projectRoot, ".env");

const envPath = existsSync(localEnv)
  ? localEnv
  : fallbackEnv;

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL non configurata. Verificare .env.local o le variabili d'ambiente."
  );
}

// Pool di connessioni PostgreSQL condiviso dal runtime applicativo.
export const postgresPool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "customer-journey-dashboard",
});

// Gestione degli errori sulle connessioni inattive.
postgresPool.on("error", (error) => {
  console.error(
    "Errore inatteso nel pool PostgreSQL:",
    error.message
  );
});

/** Verifica la connettività PostgreSQL senza modificare alcun dato. */
export async function verifyPostgresConnection(): Promise<void> {
  await verifyPostgresPool(postgresPool);
  console.log("Connessione a Neon PostgreSQL verificata.");
}
