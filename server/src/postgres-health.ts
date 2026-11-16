import type { Pool } from "pg";

/**
 * Verifica la raggiungibilità del database senza modificare dati.
 * La connessione viene sempre restituita al pool, anche in caso di errore.
 */
export async function verifyPostgresPool(pool: Pick<Pool, "connect">): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
