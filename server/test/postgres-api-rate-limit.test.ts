import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { NextFunction, Request, Response } from "express";
import {
  API_RATE_LIMIT_WINDOW_MS,
  createPostgresApiRateLimitMiddleware,
  consumePostgresApiRequest,
} from "../src/postgres-api-rate-limit.js";

function fakePool(allowed: boolean) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("RETURNING attempts <= $2")) {
      return { rows: [{ allowed }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
  return { pool, query, release };
}

describe("rate limiting persistente delle API", () => {
  it("usa una chiave HMAC e consuma il bucket nella stessa transazione", async () => {
    const mock = fakePool(true);
    await expect(consumePostgresApiRequest(
      mock.pool, "s".repeat(40), "203.0.113.19",
    )).resolves.toBe(true);

    const insert = mock.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO api_request_limits"));
    expect(insert?.[1]?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert?.[1]?.[0]).not.toContain("203.0.113.19");
    expect(insert?.[1]?.[1]).toBe(1200);
    expect(mock.query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(mock.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("restituisce false quando il bucket IP ha superato il limite", async () => {
    const mock = fakePool(false);
    await expect(consumePostgresApiRequest(
      mock.pool, "s".repeat(40), "203.0.113.19",
    )).resolves.toBe(false);
  });

  it("valida il segreto e il limite configurato", async () => {
    const mock = fakePool(true);
    await expect(consumePostgresApiRequest(mock.pool, "short", "203.0.113.19"))
      .rejects.toThrow(/32 caratteri/);
    await expect(consumePostgresApiRequest(mock.pool, "s".repeat(40), "203.0.113.19", 0))
      .rejects.toThrow(/Limite richieste API/);
    expect(mock.pool.connect).not.toHaveBeenCalled();
  });

  it("risponde 429 con Retry-After quando il bucket è esaurito", async () => {
    const mock = fakePool(false);
    const middleware = createPostgresApiRateLimitMiddleware(mock.pool, "s".repeat(40));
    const response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    const request = {
      ip: "203.0.113.19",
      socket: { remoteAddress: "203.0.113.19" },
    } as unknown as Request;

    await middleware(request, response, next);

    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", String(API_RATE_LIMIT_WINDOW_MS / 1000));
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({ error: "Troppe richieste. Riprovare più tardi." });
    expect(next).not.toHaveBeenCalled();
  });
});
