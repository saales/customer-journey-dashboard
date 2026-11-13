import type { Pool } from "pg";

const REQUIRED_RLS_TABLES = [
  "customers",
  "events",
  "funnel_stages",
  "import_batches",
  "audit_logs",
] as const;

export interface PostgresRuntimeRoleCheck {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  ownedTables: string[];
  rlsDisabledTables: string[];
}

/**
 * Fail-closed runtime check: the application role must not own protected
 * tables, be a superuser, or bypass RLS. Every tenant table must have RLS on.
 */
export async function inspectPostgresRuntimeRole(
  pool: Pick<Pool, "query">,
): Promise<PostgresRuntimeRoleCheck> {
  const roleResult = await pool.query<{
    role: string;
    superuser: boolean;
    bypassRls: boolean;
  }>(
    `SELECT current_user AS role,
            r.rolsuper AS "superuser",
            r.rolbypassrls AS "bypassRls"
     FROM pg_roles r
     WHERE r.rolname = current_user`,
  );
  const role = roleResult.rows[0];
  if (!role) throw new Error("Impossibile identificare il ruolo PostgreSQL corrente.");

  const tablesResult = await pool.query<{
    tableName: string;
    ownerName: string;
    rowSecurity: boolean;
  }>(
    `SELECT c.relname AS "tableName",
            pg_get_userbyid(c.relowner) AS "ownerName",
            c.relrowsecurity AS "rowSecurity"
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = ANY($1::text[])
       AND c.relkind IN ('r', 'p')`,
    [[...REQUIRED_RLS_TABLES]],
  );

  const byName = new Map(tablesResult.rows.map((row) => [row.tableName, row]));
  const ownedTables = REQUIRED_RLS_TABLES.filter((name) =>
    byName.get(name)?.ownerName === role.role,
  );
  const rlsDisabledTables = REQUIRED_RLS_TABLES.filter((name) =>
    !byName.get(name)?.rowSecurity,
  );

  return {
    role: role.role,
    superuser: role.superuser,
    bypassRls: role.bypassRls,
    ownedTables: [...ownedTables],
    rlsDisabledTables: [...rlsDisabledTables],
  };
}

export async function assertSafePostgresRuntimeRole(
  pool: Pick<Pool, "query">,
): Promise<void> {
  const result = await inspectPostgresRuntimeRole(pool);
  if (result.superuser || result.bypassRls || result.ownedTables.length > 0 ||
      result.rlsDisabledTables.length > 0) {
    throw new Error(
      "Ruolo PostgreSQL non sicuro: usare un ruolo applicativo non proprietario, " +
      "senza SUPERUSER/BYPASSRLS, con RLS attivo su tutte le tabelle tenant.",
    );
  }
}
