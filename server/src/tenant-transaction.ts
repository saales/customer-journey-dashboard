import type { Pool, PoolClient } from "pg";

/**
 * Esegue un'unità di lavoro sullo stesso client PostgreSQL, impostando
 * l'organizzazione come parametro locale alla transazione.
 *
 * Il contesto non sopravvive al COMMIT/ROLLBACK e quindi non deve contaminare
 * una successiva richiesta che riutilizzi la stessa connessione del pool.
 *
 * L'organizationId deve provenire dal contesto autenticato lato server,
 * mai direttamente da input del client.
 */
export async function withTenantTransaction<T>(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!organizationId.trim()) {
    throw new Error("Contesto organizzazione mancante.");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  let destroyClient = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(
      "SELECT set_config('app.organization_id', $1, true)",
      [organizationId],
    );

    const result = await work(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Un client con rollback fallito non deve rientrare nel pool.
        destroyClient = true;
      }
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}
