import { describe, expect, it } from "vitest";
import {
  isAllowedPostgresAuthOrigin,
  createPostgresAuthRouter,
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
});
