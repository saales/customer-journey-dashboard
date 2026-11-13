import type { PoolClient } from "pg";

type MetadataRows = Array<Record<string, unknown>>;

export interface PostgresSchemaReport {
  generatedAt: string;
  safety: string;
  database: Record<string, unknown> | undefined;
  tables: MetadataRows;
  columns: MetadataRows;
  constraints: MetadataRows;
  indexes: MetadataRows;
  rowLevelSecurityPolicies: MetadataRows;
  schemaMigrationsTable: Record<string, unknown> | undefined;
  currentRoleCapabilities: Record<string, unknown> | null;
}

/**
 * Raccoglie solo cataloghi e metadati in una transazione READ ONLY.
 * La connessione viene sempre rilasciata; viene distrutta se il rollback fallisce.
 */
export async function inspectPostgresSchema(
  client: Pick<PoolClient, "query" | "release">,
): Promise<PostgresSchemaReport> {
  let transactionOpen = false;
  let destroyClient = false;
  let failure: unknown;
  let report: PostgresSchemaReport | undefined;

  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;

    const [
      database,
      tables,
      columns,
      constraints,
      indexes,
      policies,
      migrationTable,
      role,
    ] = await Promise.all([
      client.query(`
        SELECT current_database() AS database,
               current_user AS database_user,
               current_schema() AS current_schema,
               current_setting('server_version') AS server_version
      `),
      client.query(`
        SELECT n.nspname AS schema, c.relname AS "table",
               owner.rolname AS table_owner,
               c.relrowsecurity AS row_level_security_enabled,
               c.relforcerowsecurity AS row_level_security_forced
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_roles owner ON owner.oid = c.relowner
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_'
          AND c.relkind IN ('r', 'p')
          AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
        ORDER BY n.nspname, c.relname
      `),
      client.query(`
        SELECT table_schema AS schema, table_name AS "table",
               ordinal_position, column_name, data_type,
               udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_schema !~ '^pg_'
        ORDER BY table_schema, table_name, ordinal_position
      `),
      client.query(`
        SELECT n.nspname AS schema, c.relname AS "table",
               con.conname AS name, con.contype AS type,
               pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_'
          AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
        ORDER BY n.nspname, c.relname, con.conname
      `),
      client.query(`
        SELECT schemaname AS schema, tablename AS "table",
               indexname AS name, indexdef AS definition
        FROM pg_catalog.pg_indexes
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          AND schemaname !~ '^pg_'
          AND pg_catalog.has_table_privilege(
            current_user, format('%I.%I', schemaname, tablename), 'SELECT'
          )
        ORDER BY schemaname, tablename, indexname
      `),
      client.query(`
        SELECT schemaname AS schema, tablename AS "table",
               policyname AS name, permissive, roles,
               cmd, qual, with_check
        FROM pg_catalog.pg_policies
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          AND schemaname !~ '^pg_'
          AND pg_catalog.has_table_privilege(
            current_user, format('%I.%I', schemaname, tablename), 'SELECT'
          )
        ORDER BY schemaname, tablename, policyname
      `),
      client.query(`
        SELECT to_regclass('public.schema_migrations') IS NOT NULL
          AS "exists"
      `),
      client.query(`
        SELECT rolname AS role, rolsuper AS is_superuser,
               rolbypassrls AS bypasses_rls, rolcreatedb AS can_create_db,
               rolcreaterole AS can_create_roles
        FROM pg_catalog.pg_roles
        WHERE rolname = current_user
      `),
    ]);

    report = {
      generatedAt: new Date().toISOString(),
      safety: "Metadata only; transaction started with BEGIN READ ONLY; no application rows read.",
      database: database.rows[0],
      tables: tables.rows,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      rowLevelSecurityPolicies: policies.rows,
      schemaMigrationsTable: migrationTable.rows[0],
      currentRoleCapabilities: role.rows[0] ?? null,
    };
  } catch (error) {
    failure = error;
  } finally {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        destroyClient = true;
        if (failure === undefined) failure = rollbackError;
      }
    }
    client.release(destroyClient);
  }

  if (failure !== undefined) throw failure;
  if (!report) throw new Error("Ispezione PostgreSQL senza risultato.");
  return report;
}
