import { postgresPool } from "./postgres.js";

type QueryResult = { rows: Record<string, unknown>[] };

/**
 * Esporta esclusivamente metadati PostgreSQL in una transazione READ ONLY.
 * Non legge righe applicative e non esegue DDL/DML.
 */
async function main(): Promise<void> {
  const client = await postgresPool.connect();
  let transactionOpen = false;
  let destroyClient = false;

  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;

    const [database, tables, columns, constraints, indexes, policies, migrationTable, role] =
      await Promise.all([
        client.query(`
          SELECT current_database() AS database,
                 current_user AS database_user,
                 current_schema() AS current_schema,
                 current_setting('server_version') AS server_version
        `),
        client.query(`
          SELECT schemaname AS schema, tablename AS table
          FROM pg_catalog.pg_tables
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY schemaname, tablename
        `),
        client.query(`
          SELECT table_schema AS schema, table_name AS table,
                 ordinal_position, column_name, data_type,
                 udt_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          ORDER BY table_schema, table_name, ordinal_position
        `),
        client.query(`
          SELECT n.nspname AS schema, c.relname AS table,
                 con.conname AS name, con.contype AS type,
                 pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY n.nspname, c.relname, con.conname
        `),
        client.query(`
          SELECT schemaname AS schema, tablename AS table,
                 indexname AS name, indexdef AS definition
          FROM pg_catalog.pg_indexes
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY schemaname, tablename, indexname
        `),
        client.query(`
          SELECT schemaname AS schema, tablename AS table,
                 policyname AS name, permissive, roles,
                 cmd, qual, with_check
          FROM pg_catalog.pg_policies
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY schemaname, tablename, policyname
        `),
        client.query(`
          SELECT to_regclass('public.schema_migrations') IS NOT NULL
            AS exists
        `),
        client.query(`
          SELECT rolname AS role, rolsuper AS is_superuser,
                 rolbypassrls AS bypasses_rls, rolcreatedb AS can_create_db,
                 rolcreaterole AS can_create_roles
          FROM pg_catalog.pg_roles
          WHERE rolname = current_user
        `),
      ]);

    const report = {
      generatedAt: new Date().toISOString(),
      safety: "Metadata only; transaction started with BEGIN READ ONLY; no application rows read.",
      database: database.rows[0],
      tables: (tables as QueryResult).rows,
      columns: (columns as QueryResult).rows,
      constraints: (constraints as QueryResult).rows,
      indexes: (indexes as QueryResult).rows,
      rowLevelSecurityPolicies: (policies as QueryResult).rows,
      schemaMigrationsTable: (migrationTable as QueryResult).rows[0],
      currentRoleCapabilities: (role as QueryResult).rows[0] ?? null,
    };

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(
      "Ispezione PostgreSQL non riuscita:",
      error instanceof Error ? error.message : "Errore sconosciuto",
    );
    process.exitCode = 1;
  } finally {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
        process.exitCode = 1;
        console.error("Rollback della transazione READ ONLY non riuscito; connessione scartata.");
      }
    }

    client.release(destroyClient);
    await postgresPool.end();
  }
}

void main();
