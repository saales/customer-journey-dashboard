import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  createSessionToken,
  hashSessionToken,
  resolvePostgresSession,
} from "../src/postgres-session-resolver.js";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL session resolver", () => {
  it("creates opaque 256-bit tokens and stores only a deterministic hash", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(first.token)).toBe(first.tokenHash);
    expect(() => hashSessionToken("short")).toThrow("Token di sessione non valido.");
  });

  it("resolves only active sessions with an active user, organization and membership", async () => {
    const organizationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const organizationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const active = createSessionToken();
    const suspendedMembership = createSessionToken();
    const expired = createSessionToken();
    const idle = createSessionToken();
    const client = await pool!.connect();

    try {
      await client.query(`
        CREATE TEMP TABLE organizations (
          id UUID PRIMARY KEY,
          status TEXT NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE users (
          id UUID PRIMARY KEY,
          status TEXT NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE memberships (
          id UUID PRIMARY KEY,
          organization_id UUID NOT NULL,
          user_id UUID NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE sessions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          organization_id UUID,
          token_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(
        `INSERT INTO organizations (id, status)
         VALUES ($1, 'active'), ($2, 'active')`,
        [organizationA, organizationB],
      );
      await client.query(
        `INSERT INTO users (id, status)
         VALUES ($1, 'active'), ($2, 'active')`,
        [userA, userB],
      );
      await client.query(
        `INSERT INTO memberships (id, organization_id, user_id, role, status)
         VALUES
           ('33333333-3333-4333-8333-333333333333', $1, $2, 'admin', 'active'),
           ('44444444-4444-4444-8444-444444444444', $3, $4, 'viewer', 'suspended')`,
        [organizationA, userA, organizationB, userB],
      );
      await client.query(
        `INSERT INTO sessions (id, user_id, organization_id, token_hash, expires_at)
         VALUES
           ('55555555-5555-4555-8555-555555555555', $1, $2, $3, NOW() + INTERVAL '1 hour'),
           ('66666666-6666-4666-8666-666666666666', $4, $5, $6, NOW() + INTERVAL '1 hour'),
           ('77777777-7777-4777-8777-777777777777', $1, $2, $7, NOW() - INTERVAL '1 hour')`,
        [
          userA, organizationA, active.tokenHash,
          userB, organizationB, suspendedMembership.tokenHash,
          expired.tokenHash,
        ],
      );
      await client.query(
        `INSERT INTO sessions (id, user_id, organization_id, token_hash, expires_at, last_used_at)
         VALUES ('88888888-8888-4888-8888-888888888888', $1, $2, $3,
                 NOW() + INTERVAL '1 hour', NOW() - INTERVAL '31 minutes')`,
        [userA, organizationA, idle.tokenHash],
      );
    } finally {
      client.release();
    }

    await expect(resolvePostgresSession(pool!, active.token)).resolves.toEqual({
      userId: userA,
      organizationId: organizationA,
      role: "admin",
    });
    const refreshed = await pool!.query<{ recent: boolean }>(
      "SELECT last_used_at > NOW() - INTERVAL '5 seconds' AS recent FROM sessions WHERE token_hash = $1",
      [active.tokenHash],
    );
    expect(refreshed.rows[0]?.recent).toBe(true);
    await expect(resolvePostgresSession(pool!, suspendedMembership.token)).resolves.toBeNull();
    await expect(resolvePostgresSession(pool!, expired.token)).resolves.toBeNull();
    await expect(resolvePostgresSession(pool!, idle.token)).resolves.toBeNull();
    await expect(resolvePostgresSession(pool!, "invalid")).resolves.toBeNull();
  });
});
