import { postgresPool } from "./postgres.js";
import { loadPostgresMigrations } from "./postgres-migrations.js";
import { verifyPostgresReadOnly } from "./postgres-readonly-verification.js";

/**
 * Verifica di sola lettura del database collegato a DATABASE_URL (es. Neon).
 * Non applica migrazioni, non scrive, non legge righe applicative.
 *
 *   npm run db:verify-readonly -- --expect-database <nome> [--role runtime|any] [--allow-no-ssl] [--estimates] [--json]
 *
 * Codici di uscita: 0 = tutti i controlli superati; 2 = almeno un controllo fallito; 1 = errore di esecuzione.
 */
function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const expectedDatabase = argValue("--expect-database") ?? process.env.READONLY_EXPECT_DATABASE;
  if (!expectedDatabase || expectedDatabase.startsWith("--")) {
    console.error("Indicare il database atteso: --expect-database <nome> (oppure READONLY_EXPECT_DATABASE).");
    process.exitCode = 1;
    return;
  }
  const role = argValue("--role") ?? "runtime";
  if (role !== "runtime" && role !== "any") {
    console.error("--role deve essere 'runtime' oppure 'any'.");
    process.exitCode = 1;
    return;
  }
  let host: string | undefined;
  try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { host = undefined; }

  try {
    const report = await verifyPostgresReadOnly(postgresPool, {
      expectedDatabase,
      migrations: await loadPostgresMigrations(),
      roleMode: role,
      requireSsl: !process.argv.includes("--allow-no-ssl"),
      includeEstimates: process.argv.includes("--estimates"),
      connectionHost: host,
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Verifica PostgreSQL in sola lettura — ${report.generatedAt}`);
      console.log(`Database: ${report.target.database} | ruolo: ${report.target.user} | versione: ${report.target.serverVersion} | TLS: ${report.target.ssl}`);
      for (const item of report.checks) {
        const mark = item.status === "pass" ? "OK  " : item.status === "warn" ? "WARN" : "FAIL";
        console.log(`[${mark}] ${item.title} — ${item.detail}`);
      }
      console.log(`Esito: ${report.ok ? "SUPERATO" : "NON SUPERATO"} (${report.summary.pass} ok, ${report.summary.warn} avvisi, ${report.summary.fail} falliti)`);
    }
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    console.error("Verifica PostgreSQL non riuscita:", error instanceof Error ? error.message : "errore sconosciuto");
    process.exitCode = 1;
  } finally {
    await postgresPool.end();
  }
}

void main();
