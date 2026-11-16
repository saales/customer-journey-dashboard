import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { getPostgresOrganizationSettings, updatePostgresOrganizationName, OrganizationSettingsError } from "../src/postgres-organization-settings.js";

const settings = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Workspace",
  slug: "workspace",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("impostazioni organizzazione PostgreSQL", () => {
  it("legge solo l'organizzazione richiesta", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM organizations")
      ? { rows: [settings], rowCount: 1 } : { rows: [], rowCount: 0 });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };
    await expect(getPostgresOrganizationSettings(pool, settings.id)).resolves.toEqual(settings);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id=$1::uuid"), [settings.id]);
  });

  it("valida il nome prima di aprire una transazione", async () => {
    const pool = { connect: vi.fn() };
    await expect(updatePostgresOrganizationName(pool, settings.id, "11111111-1111-4111-8111-111111111111", "  "))
      .rejects.toBeInstanceOf(OrganizationSettingsError);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("aggiorna il nome e registra l'evento audit nella stessa transazione", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      return sql.includes("UPDATE organizations") ? { rows: [{ ...settings, name: "New name" }], rowCount: 1 }
        : { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) };
    const result = await updatePostgresOrganizationName(pool, settings.id, "11111111-1111-4111-8111-111111111111", " New name ");
    expect(result.name).toBe("New name");
    expect(statements[0]).toBe("BEGIN");
    expect(statements.some(sql => sql.includes("set_config('app.current_organization_id'"))).toBe(true);
    expect(statements.some(sql => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
  });
});
