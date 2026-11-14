import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  isAllowedPostgresAuthOrigin,
  createPostgresAuthRouter,
  consumePostgresLoginAttempt,
  consumePostgresPasswordResetAttempt,
} from "../src/postgres-auth-routes.js";

describe("Configurazione e protezione delle rotte di accesso PostgreSQL", () => {
  const origins = new Set(["https://app.example.it", "http://localhost:5173"]);

  it("accetta esclusivamente origini esatte configurate", () => {
    expect(isAllowedPostgresAuthOrigin("https://app.example.it", origins)).toBe(true);
    expect(isAllowedPostgresAuthOrigin("https://app.example.it.evil.test", origins)).toBe(false);
    expect(isAllowedPostgresAuthOrigin("https://app.example.it/path", origins)).toBe(false);
    expect(isAllowedPostgresAuthOrigin(undefined, origins)).toBe(false);
    expect(isAllowedPostgresAuthOrigin("null", origins)).toBe(false);
  });

  it("rifiuta configurazioni senza origini o con segreto debole", () => {
    const pool = { connect: () => { throw new Error("must not connect"); } };
    expect(() => createPostgresAuthRouter(pool, {
      allowedOrigins: [], rateLimitSecret: "x".repeat(40), production: false,
    })).toThrow("Configurare almeno un'origine web autorizzata.");
    expect(() => createPostgresAuthRouter(pool, {
      allowedOrigins: ["https://app.example.it"], rateLimitSecret: "short", production: false,
    })).toThrow("LOGIN_RATE_LIMIT_SECRET deve contenere almeno 32 caratteri casuali.");
  });

  it("rifiuta origini HTTP in produzione anche se esplicitamente configurate", () => {
    const pool = { connect: () => { throw new Error("must not connect"); } };
    expect(() => createPostgresAuthRouter(pool, {
      allowedOrigins: ["http://localhost:5173"],
      rateLimitSecret: "x".repeat(40), production: true,
    })).toThrow("In produzione sono ammesse esclusivamente origini HTTPS.");
  });

  it("rifiuta origini non canoniche nella configurazione", () => {
    const pool = { connect: () => { throw new Error("must not connect"); } };
    expect(() => createPostgresAuthRouter(pool, {
      allowedOrigins: ["https://app.example.it/path"],
      rateLimitSecret: "x".repeat(40), production: false,
    })).toThrow("Le origini web devono essere URL di origine esatti.");
  });
  it("applica limiti distinti per indirizzo IP e coppia IP/email", async () => {
    const insertValues: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("RETURNING attempts <= $2")) { insertValues.push(values ?? []); return { rows: [{ allowed: true }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(consumePostgresLoginAttempt(pool, "s".repeat(40), "203.0.113.10", "user@example.test")).resolves.toBe(true);
    expect(insertValues).toHaveLength(2);
    expect(insertValues.map(values => values[1])).toEqual([60, 10]);
    expect(insertValues[0]?.[0]).not.toBe(insertValues[1]?.[0]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("updated_at < NOW() - INTERVAL '30 days'"));
  });

  it("limita il recupero password a 3 richieste per IP/email e 30 per IP", async () => {
    const values: unknown[][] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("RETURNING attempts <= $2")) {
        values.push(params ?? []);
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(consumePostgresPasswordResetAttempt(pool, "s".repeat(40), "203.0.113.10", " USER@example.test "))
      .resolves.toBe(true);
    expect(values).toHaveLength(2);
    expect(values.map(value => value[1])).toEqual([30, 3]);
    expect(values[0]?.[0]).not.toBe(values[1]?.[0]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("updated_at < NOW() - INTERVAL '30 days'"));
  });

  it("blocca il recupero password quando il bucket IP/email è esaurito", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("RETURNING attempts <= $2")) {
        return { rows: [{ allowed: params?.[1] !== 3 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(consumePostgresPasswordResetAttempt(pool, "s".repeat(40), "203.0.113.10", "user@example.test"))
      .resolves.toBe(false);
    expect(query).toHaveBeenCalledWith("COMMIT");
  });

  it("blocca tutte le email quando il bucket IP supera il limite", async () => {
    let bucket = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING attempts <= $2")) { bucket += 1; return { rows: [{ allowed: bucket !== 1 }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
    await expect(consumePostgresLoginAttempt(pool, "s".repeat(40), "203.0.113.10", "other@example.test")).resolves.toBe(false);
    expect(bucket).toBe(2);
  });
});
