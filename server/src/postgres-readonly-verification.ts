import type { Pool, PoolClient } from "pg";
import { planPostgresMigrations, type PostgresMigration } from "./postgres-migrations.js";
import { inspectPostgresRuntimeRole } from "./postgres-runtime-preflight.js";

/**
 * Verifica di sola lettura di un database PostgreSQL (es. Neon) prima di un collaudo.
 *
 * Garanzie:
 *  - ogni interrogazione gira in `BEGIN READ ONLY` e termina con `ROLLBACK`;
 *  - sono usate solo istruzioni SELECT/SHOW/SET LOCAL (verificato da un test);
 *  - NON legge righe applicative (nessun dato di organizzazioni, utenti o clienti):
 *    solo cataloghi di sistema e la tabella `schema_migrations`;
 *  - NON applica migrazioni e non modifica nulla;
 *  - si ferma PRIMA di ogni altra lettura se il nome del database non coincide
 *    con quello dichiarato dall'operatore (protezione da connessioni sbagliate).
 */

export type CheckStatus = "pass" | "fail" | "warn";
export interface ReadOnlyCheck { id: string; title: string; status: CheckStatus; detail: string; }

export interface ReadOnlyVerificationOptions {
  /** Nome database atteso, dichiarato esplicitamente dall'operatore. Obbligatorio. */
  expectedDatabase: string;
  migrations: PostgresMigration[];
  /** `runtime`: il ruolo connesso deve essere il ruolo HTTP non privilegiato. `any`: solo report. */
  roleMode?: "runtime" | "any";
  /** Se false, la connessione senza TLS è solo un avviso (utile in locale). Default: true (fallisce). */
  requireSsl?: boolean;
  /** Includi stime di righe da statistiche di catalogo (non legge le tabelle). */
  includeEstimates?: boolean;
  /** Host della connessione, solo per riconoscere un endpoint pooler; non viene mai riportato per esteso. */
  connectionHost?: string;
}

export interface ReadOnlyVerificationReport {
  generatedAt: string;
  mode: "read-only";
  target: { database: string; user: string; serverVersion: string; ssl: boolean | null; pooledEndpoint: boolean | null };
  checks: ReadOnlyCheck[];
  estimates?: Array<{ table: string; estimatedRows: number }>;
  summary: { pass: number; warn: number; fail: number };
  ok: boolean;
}

export const EXPECTED_TABLES = [
  "api_request_limits", "audit_logs", "customers", "events", "funnel_stages", "import_batches",
  "invitations", "login_attempt_limits", "memberships", "organizations", "password_reset_tokens",
  "schema_migrations", "sessions", "users",
] as const;
const RLS_TABLES = ["customers", "events", "funnel_stages", "import_batches", "audit_logs", "invitations"] as const;

/** Privilegi che il ruolo runtime NON deve avere (difesa in profondità, integrità di audit e sessioni). */
const FORBIDDEN_PRIVILEGES: ReadonlyArray<readonly [string, string]> = [
  ["audit_logs", "UPDATE"], ["audit_logs", "DELETE"], ["audit_logs", "TRUNCATE"],
  ["sessions", "UPDATE"], ["sessions", "TRUNCATE"],
  ["users", "DELETE"], ["users", "TRUNCATE"],
  ["organizations", "INSERT"], ["organizations", "DELETE"], ["organizations", "TRUNCATE"],
  ["memberships", "DELETE"], ["memberships", "TRUNCATE"],
  ["import_batches", "UPDATE"], ["import_batches", "DELETE"],
  ["customers", "TRUNCATE"], ["events", "TRUNCATE"], ["funnel_stages", "DELETE"],
  ["schema_migrations", "INSERT"], ["schema_migrations", "UPDATE"], ["schema_migrations", "DELETE"],
];

const check = (id: string, title: string, status: CheckStatus, detail: string): ReadOnlyCheck => ({ id, title, status, detail });

export async function verifyPostgresReadOnly(
  pool: Pick<Pool, "connect">,
  options: ReadOnlyVerificationOptions,
): Promise<ReadOnlyVerificationReport> {
  if (!options.expectedDatabase || !options.expectedDatabase.trim()) {
    throw new Error("Indicare esplicitamente il nome del database atteso (--expect-database).");
  }
  const roleMode = options.roleMode ?? "runtime";
  const requireSsl = options.requireSsl ?? true;
  const checks: ReadOnlyCheck[] = [];
  let target: ReadOnlyVerificationReport["target"] = { database: "", user: "", serverVersion: "", ssl: null, pooledEndpoint: null };
  let estimates: ReadOnlyVerificationReport["estimates"];

  const client: PoolClient = await pool.connect();
  let open = false;
  let destroy = false;
  let failure: unknown;
  let identityOk = false;
  try {
    await client.query("BEGIN READ ONLY");
    open = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL lock_timeout = '3s'");

    const identity = await client.query<{ database: string; user: string; version: string; readonly: string; ssl: boolean | null }>(
      `SELECT current_database() AS database, current_user AS "user",
              current_setting('server_version') AS version,
              current_setting('transaction_read_only') AS readonly,
              (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`,
    );
    const row = identity.rows[0]!;
    target = {
      database: row.database, user: row.user, serverVersion: row.version, ssl: row.ssl,
      pooledEndpoint: options.connectionHost ? /-pooler\./.test(options.connectionHost) : null,
    };

    identityOk = row.database === options.expectedDatabase;
    checks.push(check("identity.database", "Il database collegato è quello dichiarato",
      identityOk ? "pass" : "fail",
      identityOk ? `database "${row.database}" confermato` : `collegato a "${row.database}", atteso "${options.expectedDatabase}". Nessuna ulteriore lettura eseguita.`));
    checks.push(check("session.read_only", "La transazione di verifica è in sola lettura",
      row.readonly === "on" ? "pass" : "fail", `transaction_read_only = ${row.readonly}`));

    if (identityOk) {
      checks.push(check("transport.tls", "Connessione cifrata (TLS)",
        row.ssl === true ? "pass" : requireSsl ? "fail" : "warn",
        row.ssl === true ? "TLS attivo" : "connessione senza TLS (su Neon usare sslmode=require)"));
      if (target.pooledEndpoint) {
        checks.push(check("transport.pooler", "Endpoint di connessione",
          "warn", "endpoint pooler: va bene per l'app e per questa verifica; per le migrazioni usare l'endpoint diretto (advisory lock di sessione)"));
      }

      // 1) Tabelle attese e inattese (solo catalogo).
      const tables = await client.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
      const present = new Set(tables.rows.map((r) => r.name));
      const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
      const extra = [...present].filter((t) => !(EXPECTED_TABLES as readonly string[]).includes(t));
      checks.push(check("schema.tables", "Tabelle attese presenti",
        missing.length ? "fail" : "pass", missing.length ? `mancanti: ${missing.join(", ")}` : `${EXPECTED_TABLES.length} tabelle presenti`));
      if (extra.length) checks.push(check("schema.extra_tables", "Tabelle non previste dalle migrazioni", "warn", extra.join(", ")));

      // 2) RLS e policy sulle tabelle tenant.
      const rls = await client.query<{ table: string; enabled: boolean; policies: string[] }>(
        `SELECT c.relname AS "table", c.relrowsecurity AS enabled,
                COALESCE((SELECT array_agg(p.policyname::text ORDER BY p.policyname) FROM pg_policies p
                          WHERE p.schemaname = 'public' AND p.tablename = c.relname), '{}') AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`, [[...RLS_TABLES]]);
      const rlsByTable = new Map(rls.rows.map((r) => [r.table, r]));
      const rlsProblems = RLS_TABLES.flatMap((t) => {
        const r = rlsByTable.get(t);
        if (!r) return [`${t}: tabella assente`];
        const problems: string[] = [];
        if (!r.enabled) problems.push(`${t}: RLS disattivata`);
        if (!r.policies.includes("tenant_isolation")) problems.push(`${t}: policy tenant_isolation mancante`);
        if (t === "invitations" && !r.policies.includes("invitation_token_lookup")) problems.push("invitations: policy invitation_token_lookup mancante");
        return problems;
      });
      checks.push(check("rls.tenant_tables", "RLS e policy di isolamento sulle tabelle tenant",
        rlsProblems.length ? "fail" : "pass", rlsProblems.length ? rlsProblems.join("; ") : `${RLS_TABLES.length} tabelle protette`));

      // 3) Ruolo connesso. Su uno schema incompleto (es. database non ancora migrato) i controlli sui
      // privilegi non sono significativi e interrogherebbero tabelle inesistenti: si segnala e si prosegue.
      const role = missing.length ? null : await inspectPostgresRuntimeRole(client);
      if (!role) {
        checks.push(check("role.skipped", "Controlli sul ruolo e sui privilegi",
          "warn", "saltati perché lo schema è incompleto: applicare le migrazioni con la procedura di rilascio e ripetere la verifica"));
      } else if (roleMode === "runtime") {
        const problems: string[] = [];
        if (role.superuser) problems.push("SUPERUSER");
        if (role.bypassRls) problems.push("BYPASSRLS");
        if (role.inheritsPrivileges) problems.push("INHERIT");
        if (role.canCreateRoles) problems.push("CREATEROLE");
        if (role.canCreateDatabases) problems.push("CREATEDB");
        if (role.canReplicate) problems.push("REPLICATION");
        if (role.hasRoleMembership) problems.push("membro di altri ruoli");
        if (role.canCreateSchema) problems.push("CREATE sullo schema");
        if (role.ownedTables.length) problems.push(`proprietario di: ${role.ownedTables.join(", ")}`);
        checks.push(check("role.safe", `Il ruolo "${role.role}" non è privilegiato`,
          problems.length ? "fail" : "pass", problems.length ? problems.join("; ") : "nessun attributo elevato, non è owner delle tabelle tenant"));
        checks.push(check("role.rls_active", "RLS attiva per il ruolo runtime",
          role.rlsDisabledTables.length ? "fail" : "pass", role.rlsDisabledTables.length ? `RLS disattivata: ${role.rlsDisabledTables.join(", ")}` : "attiva su tutte le tabelle tenant"));
        checks.push(check("role.required_privileges", "Privilegi minimi necessari presenti",
          role.missingPrivileges.length ? "fail" : "pass", role.missingPrivileges.length ? `mancanti: ${role.missingPrivileges.join(", ")}` : "tutti presenti"));

        const forbidden = await client.query<{ table: string; privilege: string }>(
          `SELECT f.t AS "table", f.p AS privilege
           FROM unnest($1::text[], $2::text[]) AS f(t, p)
           WHERE to_regclass(format('public.%I', f.t)) IS NOT NULL
             AND has_table_privilege(current_user, format('public.%I', f.t), f.p)`,
          [FORBIDDEN_PRIVILEGES.map(([t]) => t), FORBIDDEN_PRIVILEGES.map(([, p]) => p)]);
        checks.push(check("role.forbidden_privileges", "Nessun privilegio distruttivo o di manomissione",
          forbidden.rows.length ? "fail" : "pass",
          forbidden.rows.length ? `da revocare: ${forbidden.rows.map((r) => `${r.table}:${r.privilege}`).join(", ")}` : "audit, sessioni, utenti e storico migrazioni non manomettibili"));
      } else {
        const attrs = [role.superuser && "SUPERUSER", role.bypassRls && "BYPASSRLS", role.canCreateRoles && "CREATEROLE", role.canCreateDatabases && "CREATEDB"].filter(Boolean);
        checks.push(check("role.report", `Ruolo connesso "${role.role}" (modalità report)`,
          "warn", attrs.length ? `attributi elevati: ${attrs.join(", ")} — NON usare questo ruolo per il runtime HTTP` : "nessun attributo elevato"));
      }

      // 4) Stime righe da statistiche (nessuna lettura delle tabelle).
      if (options.includeEstimates) {
        const est = await client.query<{ table: string; estimatedRows: string }>(
          `SELECT relname AS "table", GREATEST(reltuples, 0)::bigint::text AS "estimatedRows"
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname`);
        estimates = est.rows.map((r) => ({ table: r.table, estimatedRows: Number(r.estimatedRows) }));
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (open) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) { destroy = true; if (failure === undefined) failure = rollbackError; }
    }
    client.release(destroy);
  }
  if (failure !== undefined) throw failure;

  // 5) Storico migrazioni: usa il preflight esistente (anch'esso BEGIN READ ONLY / ROLLBACK).
  if (identityOk) {
    try {
      const plan = await planPostgresMigrations(pool, options.migrations);
      const total = options.migrations.length;
      checks.push(check("migrations.history", "Storico migrazioni coerente con il codice (checksum inclusi)",
        plan.drift.length ? "fail" : "pass", plan.drift.length ? plan.drift.join("; ") : `${plan.applied.length}/${total} applicate, checksum coincidenti`));
      checks.push(check("migrations.pending", "Nessuna migrazione pendente",
        plan.pending.length ? "fail" : "pass", plan.pending.length
          ? `pendenti: ${plan.pending.join(", ")} — NON applicate da questo strumento; seguire la procedura di rilascio`
          : "nessuna"));
    } catch (error) {
      checks.push(check("migrations.history", "Storico migrazioni leggibile", "fail",
        `lettura non riuscita: ${error instanceof Error ? error.message : "errore sconosciuto"}`));
    }
  }

  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  return { generatedAt: new Date().toISOString(), mode: "read-only", target, checks, ...(estimates ? { estimates } : {}), summary, ok: summary.fail === 0 };
}
