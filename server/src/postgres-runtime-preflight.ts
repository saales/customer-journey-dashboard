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
  inheritsPrivileges: boolean;
  canCreateRoles: boolean;
  canCreateDatabases: boolean;
  canReplicate: boolean;
  hasRoleMembership: boolean;
  canCreateSchema: boolean;
  ownedTables: string[];
  rlsDisabledTables: string[];
  missingPrivileges: string[];
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
    inheritsPrivileges: boolean;
    canCreateRoles: boolean;
    canCreateDatabases: boolean;
    canReplicate: boolean;
  }>(
    `SELECT current_user AS role,
            r.rolsuper AS "superuser",
            r.rolbypassrls AS "bypassRls",
            r.rolinherit AS "inheritsPrivileges",
            r.rolcreaterole AS "canCreateRoles",
            r.rolcreatedb AS "canCreateDatabases",
            r.rolreplication AS "canReplicate"
     FROM pg_roles r
     WHERE r.rolname = current_user`,
  );
  const role = roleResult.rows[0];
  if (!role) throw new Error("Impossibile identificare il ruolo PostgreSQL corrente.");

  const membershipResult = await pool.query<{ hasRoleMembership: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_auth_members
       WHERE member = current_user::regrole
     ) AS "hasRoleMembership"`,
  );
  const hasRoleMembership = membershipResult.rows[0]?.hasRoleMembership === true;
  const schemaResult = await pool.query<{ canCreateSchema: boolean }>(
    `SELECT has_schema_privilege(current_user, current_schema(), 'CREATE') AS "canCreateSchema"`,
  );
  const canCreateSchema = schemaResult.rows[0]?.canCreateSchema === true;

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

  const privilegeResult = await pool.query<{ tableName: string; privilege: string }>(
    `SELECT required.table_name AS "tableName", required.privilege
     FROM unnest(
       ARRAY['schema_migrations','users','organizations','memberships',
             'sessions','sessions','sessions',
             'login_attempt_limits','login_attempt_limits','login_attempt_limits','login_attempt_limits',
             'customers','customers','customers','customers',
             'events','events','events','events',
             'funnel_stages','funnel_stages','funnel_stages',
             'import_batches','import_batches','audit_logs']::text[],
       ARRAY['SELECT','SELECT','SELECT','SELECT',
             'SELECT','INSERT','DELETE',
             'SELECT','INSERT','UPDATE','DELETE',
             'SELECT','INSERT','UPDATE','DELETE',
             'SELECT','INSERT','UPDATE','DELETE',
             'SELECT','INSERT','UPDATE',
             'SELECT','INSERT','INSERT']::text[]
     ) AS required(table_name, privilege)
     WHERE NOT has_table_privilege(
       current_user,
       format('%I.%I', current_schema(), required.table_name),
       required.privilege
     )
     UNION ALL
     SELECT 'sessions.last_used_at' AS "tableName", 'UPDATE' AS privilege
     WHERE NOT has_column_privilege(
       current_user,
       format('%I.%I', current_schema(), 'sessions'),
       'last_used_at',
       'UPDATE'
     )`,
  );
  const missingPrivileges = privilegeResult.rows.map(
    (row) => `${row.tableName}:${row.privilege}`,
  );

  return {
    role: role.role,
    superuser: role.superuser,
    bypassRls: role.bypassRls,
    inheritsPrivileges: role.inheritsPrivileges,
    canCreateRoles: role.canCreateRoles,
    canCreateDatabases: role.canCreateDatabases,
    canReplicate: role.canReplicate,
    hasRoleMembership,
    canCreateSchema,
    ownedTables: [...ownedTables],
    rlsDisabledTables: [...rlsDisabledTables],
    missingPrivileges,
  };
}

export async function assertSafePostgresRuntimeRole(
  pool: Pick<Pool, "query">,
): Promise<void> {
  const result = await inspectPostgresRuntimeRole(pool);
  if (result.superuser || result.bypassRls || result.inheritsPrivileges ||
      result.canCreateRoles || result.canCreateDatabases || result.canReplicate ||
      result.hasRoleMembership || result.canCreateSchema ||
      result.ownedTables.length > 0 || result.rlsDisabledTables.length > 0 ||
      result.missingPrivileges.length > 0) {
    throw new Error(
      "Ruolo PostgreSQL non sicuro: usare un ruolo applicativo non proprietario, " +
      "senza SUPERUSER/BYPASSRLS, con RLS attivo e privilegi minimi completi.",
    );
  }
}
