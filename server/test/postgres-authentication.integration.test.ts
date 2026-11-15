import { afterAll, describe, expect, it, vi } from "vitest";
import * as passwordHashing from "../src/password-hashing.js";
import { Pool } from "pg";
import { authenticatePostgresCredentials } from "../src/postgres-authentication.js";
import { hashPassword } from "../src/password-hashing.js";
import {
  issuePostgresSession,
  PostgresSessionIssueError,
  revokePostgresSession,
} from "../src/postgres-session-repository.js";
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
    const legacyUserId = "edededed-eded-4ded-8ded-edededededed";
    const passwordHash = await hashPassword("Correct-Horse-Battery-42!");
    const legacyPasswordHash = "scrypt$32768$8$1$nypNbIseP1BxkqS2yNDi9A$V1Uink-dXO4qu89e0yyMjBoIcPnovdIKB2ALYqiOAVbJMCtmuMfu-4psz231onKp-Xeqa9s3j5G-thsnDfLC5w";
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
          status TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        "INSERT INTO users (id,email,password_hash,status) VALUES ($1, 'person@example.com', $2, 'active')",
        [userId, passwordHash],
      );
      await client.query(
        "INSERT INTO users (id,email,password_hash,status) VALUES ($1, 'legacy@example.com', $2, 'active')",
        [legacyUserId, legacyPasswordHash],
      );
      await client.query(
        "INSERT INTO memberships VALUES (gen_random_uuid(), $1, $2, 'admin', 'active'), (gen_random_uuid(), $1, $3, 'viewer', 'active')",
        [organizationId, userId, legacyUserId],
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

    const legacyIssued = await authenticatePostgresCredentials(
      pool!, "legacy@example.com", "Correct-Horse-Battery-42!", "acme",
    );
    expect(legacyIssued?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const upgraded = await pool!.query<{ passwordHash: string }>(
      "SELECT password_hash AS \"passwordHash\" FROM users WHERE id = $1::uuid",
      [legacyUserId],
    );
    expect(upgraded.rows[0]?.passwordHash).toMatch(/^scrypt\$32768\$8\$3\$/);
    await expect(issuePostgresSession(
      pool!, legacyUserId, organizationId, undefined, { expected: legacyPasswordHash },
    )).rejects.toBeInstanceOf(PostgresSessionIssueError);
    await expect(revokePostgresSession(pool!, legacyIssued!.token)).resolves.toBe(true);
    await expect(revokePostgresSession(pool!, issued!.token)).resolves.toBe(true);
  });

  it("performs a dummy scrypt verification when the account is unknown", async () => {
    const verification = vi.spyOn(passwordHashing, "verifyPassword").mockResolvedValue(false);
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const invalidPool = { connect: vi.fn(async () => client) };
    try {
      await expect(authenticatePostgresCredentials(
        invalidPool as never, "missing@example.com", "wrong-password-123", "acme",
      )).resolves.toBeNull();
      expect(verification).toHaveBeenCalledWith(
        "wrong-password-123",
        expect.stringMatching(/^scrypt\$32768\$8\$3\$/),
      );
    } finally {
      verification.mockRestore();
    }
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
