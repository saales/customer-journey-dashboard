import { Pool } from "pg";
import { verifyPostgresPool } from "./postgres-health.js";
import { readIntegerEnvironment } from "./runtime-config.js";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, "../../");
const localEnv = resolve(projectRoot, ".env.local");
const fallbackEnv = resolve(projectRoot, ".env");
const envPath = existsSync(localEnv) ? localEnv : fallbackEnv;
if (existsSync(envPath)) dotenv.config({ path: envPath });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL non configurata. Verificare .env.local o le variabili d'ambiente.");
}

export const postgresPool = new Pool({
  connectionString,
  max: readIntegerEnvironment(process.env, "DB_POOL_MAX", 5, 1, 50),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "customer-journey-dashboard",
});

postgresPool.on("error", (error) => {
  console.error("Errore inatteso nel pool PostgreSQL:", error.message);
});

export async function verifyPostgresConnection(): Promise<void> {
  await verifyPostgresPool(postgresPool);
  console.log("Connessione a Neon PostgreSQL verificata.");
}
