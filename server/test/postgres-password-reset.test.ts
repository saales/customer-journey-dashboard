import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { createPostgresPasswordReset, consumePostgresPasswordReset } from "../src/postgres-password-reset.js";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "person@example.test",
  fullName: "Example Person",
  organizationId: "22222222-2222-4222-8222-222222222222",
};

describe("recupero password PostgreSQL", () => {
  it("non crea token per account non trovato", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };
    await expect(createPostgresPasswordReset(pool, user.email, "org")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("memorizza solo l'hash del token e applica una scadenza di 30 minuti", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("SELECT u.id::text")
      ? { rows: [user] } : { rows: [] });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };
    const result = await createPostgresPasswordReset(pool, user.email, "org");
    expect(result?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result?.organizationId).toBe(user.organizationId);
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO password_reset_tokens"));
    expect(insert?.[0]).toContain("INTERVAL '30 minutes'");
    expect(insert?.[1]?.[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert?.[1]?.[2]).not.toBe(result?.token);
  });

  it("rifiuta token malformati prima di aprire una connessione", async () => {
    const pool = { connect: vi.fn() };
    await expect(consumePostgresPasswordReset(pool, "bad", "a-very-long-password")).rejects.toThrow("Token di recupero non valido");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("consuma il token una sola volta, aggiorna la password e revoca tutte le sessioni", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("SELECT user_id::text")) return { rows: [{ userId: user.id, organizationId: user.organizationId }] };
      if (sql.includes("UPDATE users SET")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };
    await expect(consumePostgresPasswordReset(pool, "A".repeat(43), "a-very-long-password")).resolves.toBe(true);
    expect(statements).toContain("BEGIN");
    expect(statements.some(sql => sql.includes("FOR UPDATE"))).toBe(true);
    expect(statements.some(sql => sql.includes("UPDATE password_reset_tokens SET consumed_at"))).toBe(true);
    expect(statements.some(sql => sql.includes("DELETE FROM sessions"))).toBe(true);
    expect(statements.some(sql => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(statements).toContain("COMMIT");
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("rifiuta un token scaduto o già consumato senza modificare l'account", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => { statements.push(sql); return { rows: [] }; });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };
    await expect(consumePostgresPasswordReset(pool, "B".repeat(43), "a-very-long-password")).resolves.toBe(false);
    expect(statements).toContain("ROLLBACK");
    expect(statements.some(sql => sql.includes("UPDATE users SET"))).toBe(false);
    expect(statements.some(sql => sql.includes("DELETE FROM sessions"))).toBe(false);
  });
});
