import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { deleteTenant, planTenantDeletion } from "./postgres-tenant-deletion.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
for (const file of [".env.local", ".env"]) {
  if (existsSync(resolve(root, file))) { dotenv.config({ path: resolve(root, file) }); break; }
}
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const url = process.env.TENANT_ADMIN_DATABASE_URL?.trim();
  if (!url) throw new Error("TENANT_ADMIN_DATABASE_URL obbligatoria: usare il ruolo proprietario, non quello HTTP.");
  const slug = arg("--slug");
  const database = arg("--confirm-database");
  if (!slug || !database) throw new Error("Indicare --slug e --confirm-database.");
  const execute = process.argv.includes("--execute");
  if (execute && !process.argv.includes("--confirm-backup")) {
    throw new Error("Prima di cancellare eseguire e verificare backup e ripristino; aggiungere --confirm-backup solo dopo la verifica.");
  }
  if (execute && arg("--confirm-slug") !== slug) {
    throw new Error("Per eseguire indicare --confirm-slug identico a --slug.");
  }
  const pool = new Pool({
    connectionString: url, max: 1, connectionTimeoutMillis: 10_000,
    application_name: "percorso-tenant-deletion",
  });
  try {
    if (!execute) {
      console.log(JSON.stringify({ mode: "anteprima (nessuna scrittura)", ...(await planTenantDeletion(pool, slug, database)) }, null, 2));
      return;
    }
    const receipt = await deleteTenant(pool, slug, { expectedDatabase: database, confirmSlug: arg("--confirm-slug")! });
    console.log(JSON.stringify({ mode: "cancellazione eseguita", ...receipt }, null, 2));
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error("Cancellazione tenant non riuscita:", error instanceof Error ? error.message : "errore sconosciuto");
  process.exitCode = 1;
});
