import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { deleteTenant, planTenantDeletion } from "./postgres-tenant-deletion.js";

/**
 * Cancellazione definitiva di un tenant. Per impostazione predefinita è UNA ANTEPRIMA (nessuna scrittura).
 *
 *   TENANT_ADMIN_DATABASE_URL=<ruolo proprietario> npm run db:delete-tenant -- --slug <slug> --confirm-database <db>
 *   ... aggiungere  --execute --confirm-slug <slug>  per cancellare davvero (prima: backup e prova di ripristino).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
for (const file of [".env.local", ".env"]) if (existsSync(resolve(root, file))) { dotenv.config({ path: resolve(root, file) }); break; }
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const url = process.env.TENANT_ADMIN_DATABASE_URL?.trim();
  if (!url) throw new Error("TENANT_ADMIN_DATABASE_URL obbligatoria: usare il ruolo proprietario, non quello HTTP.");
  const slug = arg("--slug"), database = arg("--confirm-database");
  if (!slug || !database) throw new Error("Indicare --slug e --confirm-database.");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, application_name: "percorso-tenant-deletion" });
  try {
    if (!process.argv.includes("--execute")) {
      console.log(JSON.stringify({ mode: "anteprima (nessuna scrittura)", ...(await planTenantDeletion(pool, slug, database)) }, null, 2));
      return;
    }
    const receipt = await deleteTenant(pool, slug, { expectedDatabase: database, confirmSlug: arg("--confirm-slug") ?? "" });
    console.log(JSON.stringify({ mode: "cancellazione eseguita", ...receipt }, null, 2));
  } finally { await pool.end(); }
}
main().catch((error) => { console.error("Cancellazione tenant non riuscita:", error instanceof Error ? error.message : "errore sconosciuto"); process.exitCode = 1; });
