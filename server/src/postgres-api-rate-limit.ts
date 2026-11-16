import { createHmac } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool, PoolClient } from "pg";

export const API_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_API_REQUESTS_PER_WINDOW = 1200;

function apiRateLimitKey(secret: string, address: string): string {
  return createHmac("sha256", secret)
    .update("api-ip")
    .update("\0")
    .update(address)
    .digest("hex");
}

/** Consuma un bucket IP persistente: il database non memorizza mai l'indirizzo. */
export async function consumePostgresApiRequest(
  pool: Pick<Pool, "connect">,
  secret: string,
  address: string,
  limit = MAX_API_REQUESTS_PER_WINDOW,
): Promise<boolean> {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("LOGIN_RATE_LIMIT_SECRET deve contenere almeno 32 caratteri casuali.");
  }
  if (typeof address !== "string" || !address.trim()) {
    throw new Error("Indirizzo client non valido per il rate limiting.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error("Limite richieste API non valido.");
  }

  const keyHash = apiRateLimitKey(secret, address);
  const client: PoolClient = await pool.connect();
  let transaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    const result = await client.query<{ allowed: boolean }>(
      `INSERT INTO api_request_limits (key_hash, window_started_at, attempts)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (key_hash) DO UPDATE
       SET attempts = CASE
             WHEN api_request_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
             ELSE api_request_limits.attempts + 1
           END,
           window_started_at = CASE
             WHEN api_request_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
             ELSE api_request_limits.window_started_at
           END,
           updated_at = NOW()
       RETURNING attempts <= $2 AS allowed`,
      [keyHash, limit],
    );
    await client.query("COMMIT");
    transaction = false;
    return result.rows[0]?.allowed === true;
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    throw error;
  } finally {
    client.release(destroy);
  }
}

export function createPostgresApiRateLimitMiddleware(
  pool: Pick<Pool, "connect">,
  secret: string,
  limit = MAX_API_REQUESTS_PER_WINDOW,
): RequestHandler {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("LOGIN_RATE_LIMIT_SECRET deve contenere almeno 32 caratteri casuali.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error("Limite richieste API non valido.");
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const address = req.ip || req.socket.remoteAddress || "unknown";
    try {
      const allowed = await consumePostgresApiRequest(pool, secret, address, limit);
      if (!allowed) {
        res.setHeader("Retry-After", String(API_RATE_LIMIT_WINDOW_MS / 1000));
        res.status(429).json({ error: "Troppe richieste. Riprovare più tardi." });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
