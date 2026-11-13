import { describe, expect, it } from "vitest";
import {
  assertSafePostgresRuntimeRole,
  inspectPostgresRuntimeRole,
} from "../src/postgres-runtime-preflight.js";

function makePool(role: Record<string, unknown>, tables: Record<string, unknown>[]) {
  return {
    query: async (sql: string) => ({
      rows: sql.includes("pg_roles") ? [role]
        : sql.includes("pg_auth_members") ? [{ hasRoleMembership: false }]
        : sql.includes("has_schema_privilege") ? [{ canCreateSchema: false }]
        : sql.includes("has_table_privilege") ? [] : tables,
      rowCount: sql.includes("pg_roles") ? 1 : tables.length,
    }),
  };
}

const goodRole = { role: "percorso_app", superuser: false, bypassRls: false, inheritsPrivileges: false, canCreateRoles: false, canCreateDatabases: false, canReplicate: false };
const goodTables = ["customers", "events", "funnel_stages", "import_batches", "audit_logs", "invitations"]
  .map((tableName) => ({ tableName, ownerName: "percorso_owner", rowSecurity: true }));

describe("Preflight sicurezza ruolo PostgreSQL", () => {
  it("accetta un ruolo applicativo separato con RLS attivo", async () => {
    const pool = makePool(goodRole, goodTables);
    const result = await inspectPostgresRuntimeRole(pool as never);
    expect(result.ownedTables).toEqual([]);
    expect(result.rlsDisabledTables).toEqual([]);
    expect(result.missingPrivileges).toEqual([]);
    await expect(assertSafePostgresRuntimeRole(pool as never)).resolves.toBeUndefined();
  });

  it("rifiuta superuser, BYPASSRLS e tabelle possedute dal ruolo", async () => {
    const unsafe = makePool(
      { role: "postgres", superuser: true, bypassRls: true },
      goodTables.map((row) => ({ ...row, ownerName: "postgres" })),
    );
    await expect(assertSafePostgresRuntimeRole(unsafe as never)).rejects.toThrow(
      "Ruolo PostgreSQL non sicuro",
    );
  });

  it("rifiuta tabelle tenant prive di RLS o mancanti", async () => {
    const unsafe = makePool(goodRole, goodTables.filter((row) => row.tableName !== "events")
      .map((row) => row.tableName === "customers" ? { ...row, rowSecurity: false } : row));
    const result = await inspectPostgresRuntimeRole(unsafe as never);
    expect(result.rlsDisabledTables).toContain("customers");
    expect(result.rlsDisabledTables).toContain("events");
    await expect(assertSafePostgresRuntimeRole(unsafe as never)).rejects.toThrow(
      "Ruolo PostgreSQL non sicuro",
    );
  });
  it("rifiuta un ruolo privo dei privilegi applicativi richiesti", async () => {
    const pool = {
      query: async (sql: string) => ({
        rows: sql.includes("pg_roles") ? [goodRole]
          : sql.includes("pg_auth_members") ? [{ hasRoleMembership: false }]
          : sql.includes("has_schema_privilege") ? [{ canCreateSchema: false }]
          : sql.includes("has_table_privilege")
            ? [{ tableName: "customers", privilege: "INSERT" }]
            : goodTables,
        rowCount: 1,
      }),
    };
    const result = await inspectPostgresRuntimeRole(pool as never);
    expect(result.missingPrivileges).toEqual(["customers:INSERT"]);
    await expect(assertSafePostgresRuntimeRole(pool as never)).rejects.toThrow(
      "Ruolo PostgreSQL non sicuro",
    );
  });


  it("verifica anche i privilegi del rate limiter API persistente", async () => {
    const pool = {
      query: async (sql: string) => ({
        rows: sql.includes("pg_roles") ? [goodRole]
          : sql.includes("pg_auth_members") ? [{ hasRoleMembership: false }]
          : sql.includes("has_schema_privilege") ? [{ canCreateSchema: false }]
          : sql.includes("has_table_privilege")
            ? [{ tableName: "api_request_limits", privilege: "INSERT" }]
            : goodTables,
        rowCount: 1,
      }),
    };
    const result = await inspectPostgresRuntimeRole(pool as never);
    expect(result.missingPrivileges).toEqual(["api_request_limits:INSERT"]);
    await expect(assertSafePostgresRuntimeRole(pool as never)).rejects.toThrow(
      "Ruolo PostgreSQL non sicuro",
    );
  });

  it("rifiuta ruoli che ereditano privilegi o appartengono ad altri ruoli", async () => {
    const unsafe = {
      query: async (sql: string) => ({
        rows: sql.includes("pg_roles")
          ? [{ ...goodRole, inheritsPrivileges: true }]
          : sql.includes("pg_auth_members") ? [{ hasRoleMembership: true }]
          : sql.includes("has_schema_privilege") ? [{ canCreateSchema: false }]
          : [],
        rowCount: 1,
      }),
    };
    await expect(assertSafePostgresRuntimeRole(unsafe as never)).rejects.toThrow(
      "Ruolo PostgreSQL non sicuro",
    );
  });

});
