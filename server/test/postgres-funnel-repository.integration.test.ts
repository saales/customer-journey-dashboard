import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  listPostgresFunnelStages,
  reorderPostgresFunnelStages,
} from "../src/postgres-funnel-repository.js";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL funnel repository", () => {
  it.skipIf(!pool)("lists and reorders the complete funnel atomically within one tenant", async () => {
    const organizationA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const organizationB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const client = await pool!.connect();

    try {
      await client.query(`
        CREATE TEMP TABLE funnel_stages (
          organization_id UUID NOT NULL,
          id VARCHAR(80) NOT NULL,
          label VARCHAR(50) NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (organization_id, id),
          UNIQUE (organization_id, position)
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(
        `INSERT INTO funnel_stages (organization_id, id, label, position, is_active)
         VALUES
           ($1, 'visit', 'Visita', 0, TRUE),
           ($1, 'lead', 'Lead', 1, TRUE),
           ($1, 'customer', 'Cliente', 2, FALSE),
           ($2, 'visit', 'Visita B', 0, TRUE)`,
        [organizationA, organizationB],
      );
    } finally {
      client.release();
    }

    const initial = await listPostgresFunnelStages(pool!, organizationA);
    expect(initial.map((stage) => stage.id)).toEqual(["visit", "lead", "customer"]);
    expect(initial[2]?.isActive).toBe(false);

    const reordered = await reorderPostgresFunnelStages(pool!, organizationA, [
      "lead",
      "visit",
      "customer",
    ]);
    expect(reordered.map((stage) => [stage.id, stage.position])).toEqual([
      ["lead", 0],
      ["visit", 1],
      ["customer", 2],
    ]);

    const tenantB = await listPostgresFunnelStages(pool!, organizationB);
    expect(tenantB.map((stage) => [stage.id, stage.position])).toEqual([["visit", 0]]);
  });

  it("rejects duplicate or incomplete reorder requests before connecting", async () => {
    const invalidPool = { connect: () => { throw new Error("must not connect"); } };
    const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await expect(reorderPostgresFunnelStages(invalidPool, organizationId, ["visit", "visit"]))
      .rejects.toThrow("Identificativi fase non validi o duplicati.");
  });

  it.skipIf(!pool)("updates labels and activation only inside the selected organization", async () => {
    const organizationA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const organizationB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const client = await pool!.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE funnel_stages (
          organization_id UUID NOT NULL,
          id VARCHAR(80) NOT NULL,
          label VARCHAR(50) NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (organization_id, id),
          UNIQUE (organization_id, position)
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(
        `INSERT INTO funnel_stages (organization_id, id, label, position, is_active)
         VALUES
           ($1, 'visit', 'Visita', 0, TRUE),
           ($1, 'lead', 'Contatto', 1, TRUE),
           ($1, 'customer', 'Cliente', 2, TRUE),
           ($2, 'lead', 'Contatto B', 0, TRUE)`,
        [organizationA, organizationB],
      );
    } finally {
      client.release();
    }

    const updated = await updatePostgresFunnelStage(pool!, organizationA, "lead", {
      label: "Qualificazione",
      isActive: false,
    });
    expect(updated).toMatchObject({
      id: "lead",
      label: "Qualificazione",
      isActive: false,
    });

    // A valid stage ID in another organization must not expose or mutate its row.
    await expect(
      updatePostgresFunnelStage(pool!, organizationA, "missing", { label: "Nuova" }),
    ).rejects.toThrow("Fase del percorso non trovata.");
    const untouched = await listPostgresFunnelStages(pool!, organizationB);
    expect(untouched[0]).toMatchObject({ id: "lead", label: "Contatto B", isActive: true });
  });

  it.skipIf(!pool)("rejects duplicate labels and deactivation of mandatory boundary stages", async () => {
    const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const client = await pool!.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE funnel_stages (
          organization_id UUID NOT NULL,
          id VARCHAR(80) NOT NULL,
          label VARCHAR(50) NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (organization_id, id),
          UNIQUE (organization_id, position)
        ) ON COMMIT PRESERVE ROWS
      `);
      await client.query(
        `INSERT INTO funnel_stages (organization_id, id, label, position)
         VALUES ($1, 'visit', 'Visita', 0), ($1, 'lead', 'Contatto', 1), ($1, 'customer', 'Cliente', 2)`,
        [organizationId],
      );
    } finally {
      client.release();
    }

    await expect(
      updatePostgresFunnelStage(pool!, organizationId, "lead", { label: "VISITA" }),
    ).rejects.toThrow("Esiste già una fase con questo nome.");
    await expect(
      updatePostgresFunnelStage(pool!, organizationId, "visit", { isActive: false }),
    ).rejects.toThrow("Le fasi Visita e Cliente non possono essere disattivate.");
  });

  it("rejects malformed updates before opening a database connection", async () => {
    const invalidPool = { connect: () => { throw new Error("must not connect"); } };
    const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await expect(
      updatePostgresFunnelStage(invalidPool, organizationId, "lead", { isActive: "false" }),
    ).rejects.toThrow("Il campo isActive deve essere booleano.");
    await expect(
      updatePostgresFunnelStage(invalidPool, organizationId, "visit", { isActive: false }),
    ).rejects.toThrow("Le fasi Visita e Cliente non possono essere disattivate.");
  });

});
