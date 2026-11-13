import "dotenv/config";
import { postgresPool } from "./postgres.js";
import { cleanupPostgresLoginAttemptLimits } from "./postgres-login-attempt-maintenance.js";

async function main(): Promise<void> {
  const raw = process.env.LOGIN_ATTEMPT_RETENTION_DAYS ?? "7";
  if (!/^\d+$/.test(raw)) throw new Error("LOGIN_ATTEMPT_RETENTION_DAYS non valido.");
  const retentionDays = Number(raw);
  let totalDeleted = 0;
  try {
    for (let batch = 0; batch < 100; batch += 1) {
      const result = await cleanupPostgresLoginAttemptLimits(postgresPool, retentionDays, 1000);
      totalDeleted += result.deleted;
      if (result.deleted < 1000) break;
    }
    console.log(`Record di limitazione login eliminati: ${totalDeleted}. Retention: ${retentionDays} giorni.`);
  } finally {
    await postgresPool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Pulizia limiti login non riuscita:", error instanceof Error ? error.message : "errore sconosciuto");
  process.exitCode = 1;
});
