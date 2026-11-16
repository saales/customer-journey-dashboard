import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { authenticatePostgresCredentials } from "../src/postgres-authentication.js";
import { hashPassword } from "../src/password-hashing.js";
import { revokePostgresSession } from "../src/postgres-session-repository.js";
import { resolvePostgresSession } from "../src/postgres-session-resolver.js";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL credential authentication", () => {
  it.skipIf(!pool)("authenticates active memberships and issues a resolvable session", async () => {
    const organizationId = "abababab-abab-4bab-8bab-abababababab";
    const userId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    const passwordHash = await hashPassword("Correct-Horse-Battery-42!");
    const client = await pool!.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE organizations (
          id UUID PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE users (
          id UUID PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL,
          status TEXT NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE memberships (
          id UUID PRIMARY KEY, organization_id UUID NOT NULL, user_id UUID NOT NULL,
          role TEXT NOT NULL, status TEXT NOT NULL
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
          organization_id UUID, token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query("INSERT INTO organizations VALUES ($1, 'acme', 'active')", [organizationId]);
      await client.query(
        "INSERT INTO users VALUES ($1, 'person@example.com', $2, 'active')",
        [userId, passwordHash],
      );
      await client.query(
        "INSERT INTO memberships VALUES (gen_random_uuid(), $1, $2, 'admin', 'active')",
        [organizationId, userId],
      );
    } finally {
      client.release();
    }

    const issued = await authenticatePostgresCredentials(
      pool!, "PERSON@example.com", "Correct-Horse-Battery-42!", "acme",
    );
    expect(issued?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(resolvePostgresSession(pool!, issued!.token)).resolves.toMatchObject({
      userId, organizationId, role: "admin",
    });
    await expect(authenticatePostgresCredentials(
      pool!, "person@example.com", "wrong-password-123", "acme",
    )).resolves.toBeNull();
    await expect(authenticatePostgresCredentials(
      pool!, "missing@example.com", "wrong-password-123", "acme",
    )).resolves.toBeNull();
    await expect(revokePostgresSession(pool!, issued!.token)).resolves.toBe(true);
  });

  it("rejects malformed credential input before opening a connection", async () => {
    const invalidPool = { connect: () => { throw new Error("must not connect"); } };
    await expect(authenticatePostgresCredentials(
      invalidPool, "not-an-email", "password", "acme",
    )).resolves.toBeNull();
    await expect(authenticatePostgresCredentials(
      invalidPool, "person@example.com", "x".repeat(1025), "acme",
    )).resolves.toBeNull();
    await expect(authenticatePostgresCredentials(
      invalidPool, "person@example.com", "password", "../acme",
    )).resolves.toBeNull();
  });
});
