import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { issuePostgresSession, revokePostgresSession } from "../src/postgres-session-repository.js";
import { resolvePostgresSession } from "../src/postgres-session-resolver.js";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL session repository", () => {
  it.skipIf(!pool)("issues only for active memberships and supports revocation", async () => {
    const organizationId = "abababab-abab-4bab-8bab-abababababab";
    const userId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    const client = await pool!.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE organizations (id UUID PRIMARY KEY, status TEXT NOT NULL)
        ON COMMIT PRESERVE ROWS
      `);
      await client.query(`
        CREATE TEMP TABLE users (id UUID PRIMARY KEY, status TEXT NOT NULL)
        ON COMMIT PRESERVE ROWS
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
      await client.query("INSERT INTO organizations VALUES ($1, 'active')", [organizationId]);
      await client.query("INSERT INTO users VALUES ($1, 'active')", [userId]);
      await client.query(
        "INSERT INTO memberships VALUES (gen_random_uuid(), $1, $2, 'admin', 'active')",
        [organizationId, userId],
      );
    } finally {
      client.release();
    }

    const issued = await issuePostgresSession(pool!, userId, organizationId);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(resolvePostgresSession(pool!, issued.token)).resolves.toMatchObject({
      userId, organizationId, role: "admin",
    });
    await expect(revokePostgresSession(pool!, issued.token)).resolves.toBe(true);
    await expect(resolvePostgresSession(pool!, issued.token)).resolves.toBeNull();
    await expect(revokePostgresSession(pool!, issued.token)).resolves.toBe(false);
  });

  it("rejects invalid identifiers and session lifetimes before connecting", async () => {
    const invalidPool = { connect: () => { throw new Error("must not connect"); } };
    await expect(issuePostgresSession(invalidPool, "bad", "bad"))
      .rejects.toThrow("Identificativo utente o organizzazione non valido.");
    await expect(issuePostgresSession(
      invalidPool,
      "abababab-abab-4bab-8bab-abababababab",
      "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      1,
    )).rejects.toThrow("Durata della sessione non valida.");
  });
});
