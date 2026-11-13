import { createPostgresApp } from "./postgres-app.js";
import { postgresPool } from "./postgres.js";
import { loadPostgresMigrations, planPostgresMigrations } from "./postgres-migrations.js";
import { assertSafePostgresRuntimeRole } from "./postgres-runtime-preflight.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile ${name} obbligatoria.`);
  return value;
}

async function main(): Promise<void> {
  const allowedOrigins = requiredEnvironment("APP_ORIGIN")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const rateLimitSecret = requiredEnvironment("LOGIN_RATE_LIMIT_SECRET");
  if (rateLimitSecret.length < 32) {
    throw new Error("LOGIN_RATE_LIMIT_SECRET deve contenere almeno 32 caratteri casuali.");
  }

  // Startup read-only: non applica mai migrazioni o modifica dati remoti.
  const migrations = await loadPostgresMigrations();
  const plan = await planPostgresMigrations(postgresPool, migrations);
  if (plan.pending.length || plan.drift.length) {
    throw new Error(
      `Schema PostgreSQL non pronto. Migrazioni mancanti: ${plan.pending.join(", ") || "nessuna"}. ` +
      `Incoerenze: ${plan.drift.join("; ") || "nessuna"}. Eseguire il preflight e la procedura migrazioni separatamente.`,
    );
  }

  await assertSafePostgresRuntimeRole(postgresPool);

  const production = process.env.NODE_ENV === "production";
  const app = createPostgresApp(postgresPool, {
    allowedOrigins,
    rateLimitSecret,
    production,
    trustedProxyIps: (process.env.TRUSTED_PROXY_IPS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  });
  const port = Number(process.env.PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT non valido.");
  }

  const server = app.listen(port, () => {
    console.log(`Runtime PostgreSQL in ascolto sulla porta ${port}.`);
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`Arresto richiesto (${signal}).`);
    server.close((error) => {
      void postgresPool.end().finally(() => {
        if (error) {
          console.error("Errore durante la chiusura HTTP:", error.message);
          process.exitCode = 1;
        }
      });
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch(async (error: unknown) => {
  console.error(
    "Avvio runtime PostgreSQL non riuscito:",
    error instanceof Error ? error.message : "errore sconosciuto",
  );
  await postgresPool.end().catch(() => undefined);
  process.exitCode = 1;
});
