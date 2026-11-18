import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { loadPostgresMigrations, type PostgresMigration } from "../src/postgres-migrations.js";
import { verifyPostgresReadOnly } from "../src/postgres-readonly-verification.js";
import { createHttpTestEnvironment, integrationDatabaseUrl, type HttpTestEnvironment } from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;
let migrations: PostgresMigration[];

/** Le migrazioni dell'ambiente di test usano un nome ruolo univoco: lo stesso testo va usato per i checksum. */
beforeAll(async () => {
  if (!dbUrl) return;
  env = await createHttpTestEnvironment();
  migrations = (await loadPostgresMigrations()).map((m) => ({ ...m, sql: m.sql.replaceAll("percorso_app", env.runtimeRole) }));
}, 60_000);
afterAll(async () => { await env?.close(); });

const options = () => ({ expectedDatabase: env.databaseName, migrations, requireSsl: false });
const byId = (report: { checks: Array<{ id: string; status: string; detail: string }> }, id: string) => report.checks.find((c) => c.id === id)!;

/** Registra ogni istruzione inviata al database da una pool, per dimostrare che è solo lettura. */
function recordingPool(real: Pick<Pool, "connect">, log: string[]): Pick<Pool, "connect"> {
  return {
    connect: async () => {
      const client = await real.connect();
      const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
        const first = args[0];
        log.push(typeof first === "string" ? first : (first as { text?: string })?.text ?? "");
        return original(...args);
      };
      return client as PoolClient;
    },
  };
}

describe.skipIf(!dbUrl)("Verifica read-only del database (ruolo runtime reale)", () => {
  it("database sano con ruolo runtime: tutti i controlli superati", async () => {
    const report = await verifyPostgresReadOnly(env.runtimePool, options());
    expect(report.checks.filter((c) => c.status === "fail"), JSON.stringify(report.checks.filter((c) => c.status === "fail"))).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.target).toMatchObject({ database: env.databaseName, user: env.runtimeRole });
    for (const id of ["identity.database", "session.read_only", "schema.tables", "rls.tenant_tables", "role.safe", "role.rls_active",
      "role.required_privileges", "role.forbidden_privileges", "migrations.history", "migrations.pending"]) {
      expect(byId(report, id).status, id).toBe("pass");
    }
  });

  it("emette SOLO SELECT/SHOW/SET LOCAL in una transazione READ ONLY chiusa da ROLLBACK (nessuna scrittura, nessun DDL)", async () => {
    const log: string[] = [];
    await verifyPostgresReadOnly(recordingPool(env.runtimePool, log), options());
    expect(log.length).toBeGreaterThan(8);
    for (const sql of log) {
      expect(sql.trim(), sql).toMatch(/^(BEGIN READ ONLY|ROLLBACK|SELECT|SHOW|SET LOCAL)\b/i);
      expect(sql, sql).not.toMatch(/(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s|CREATE\s+(TABLE|INDEX|ROLE|SCHEMA)|ALTER\s+(TABLE|ROLE)|DROP\s+(TABLE|ROLE)|GRANT\s|REVOKE\s)/i);
    }
    // Ogni BEGIN è seguito da un ROLLBACK, e non c'è alcun COMMIT.
    const begins = log.filter((s) => /^BEGIN READ ONLY/i.test(s.trim())).length;
    expect(log.filter((s) => /^ROLLBACK/i.test(s.trim())).length).toBe(begins);
    expect(log.some((s) => /^COMMIT/i.test(s.trim()))).toBe(false);
  });

  it("non legge righe applicative: nessuna query su customers, events, users, sessions, memberships, invitations o audit_logs come FROM", async () => {
    const log: string[] = [];
    await verifyPostgresReadOnly(recordingPool(env.runtimePool, log), options());
    for (const sql of log) {
      expect(sql, sql).not.toMatch(/\bFROM\s+(public\.)?(customers|events|users|sessions|memberships|invitations|audit_logs|import_batches|organizations)\b/i);
    }
  });

  it("lo stato del database resta identico dopo la verifica (nessuna scrittura osservabile)", async () => {
    const fingerprint = async () => (await env.adminPool.query(
      `SELECT (SELECT COUNT(*) FROM customers) c, (SELECT COUNT(*) FROM events) e, (SELECT COUNT(*) FROM audit_logs) a,
              (SELECT COUNT(*) FROM sessions) s, (SELECT COUNT(*) FROM schema_migrations) m,
              (SELECT string_agg(version || checksum, ',' ORDER BY version) FROM schema_migrations) h`)).rows[0];
    const before = await fingerprint();
    await verifyPostgresReadOnly(env.runtimePool, options());
    expect(await fingerprint()).toEqual(before);
  });

  it("database sbagliato: si ferma subito, segnala l'errore e NON esegue altre letture", async () => {
    const log: string[] = [];
    const report = await verifyPostgresReadOnly(recordingPool(env.runtimePool, log), { ...options(), expectedDatabase: "produzione" });
    expect(report.ok).toBe(false);
    expect(byId(report, "identity.database")).toMatchObject({ status: "fail" });
    expect(report.checks.map((c) => c.id)).toEqual(["identity.database", "session.read_only"]);
    expect(log.some((s) => /pg_class|pg_policies|schema_migrations/.test(s))).toBe(false);
  });

  it("database vuoto (non ancora migrato): esito NON superato con migrazioni pendenti, senza errori né scritture", async () => {
    const name = `${env.databaseName}_vuoto`;
    await env.adminPool.query(`CREATE DATABASE "${name}"`);
    const { Pool } = await import("pg");
    const url = new URL(dbUrl!);
    url.pathname = `/${name}`;
    const empty = new Pool({ connectionString: url.toString(), max: 1 });
    empty.on("error", () => undefined);
    try {
      const report = await verifyPostgresReadOnly(empty, { expectedDatabase: name, migrations, requireSsl: false });
      expect(report.ok).toBe(false);
      expect(byId(report, "schema.tables").status).toBe("fail");
      expect(byId(report, "migrations.pending").detail).toMatch(/001/);
      expect(byId(report, "role.skipped").status).toBe("warn");
      const created = await empty.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'");
      expect(created.rows[0].n).toBe(0); // la verifica non ha creato nulla (nemmeno schema_migrations)
    } finally {
      await empty.end();
      await env.adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });

  it("richiede una conferma esplicita del nome del database", async () => {
    await expect(verifyPostgresReadOnly(env.runtimePool, { ...options(), expectedDatabase: "  " })).rejects.toThrow(/database atteso/);
  });

  it("connessione con ruolo proprietario/superuser in modalità runtime → FALLISCE (ruolo non sicuro)", async () => {
    const report = await verifyPostgresReadOnly(env.adminPool, options());
    expect(report.ok).toBe(false);
    expect(byId(report, "role.safe").status).toBe("fail");
    expect(byId(report, "role.safe").detail).toMatch(/SUPERUSER/);
    // In modalità report lo stesso ruolo non fa fallire la verifica ma viene segnalato.
    const info = await verifyPostgresReadOnly(env.adminPool, { ...options(), roleMode: "any" });
    expect(byId(info, "role.report").status).toBe("warn");
  });

  it("migrazione modificata dopo l'applicazione (checksum diverso) → FALLISCE", async () => {
    await env.adminPool.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version='013'");
    try {
      const report = await verifyPostgresReadOnly(env.runtimePool, options());
      expect(byId(report, "migrations.history").status).toBe("fail");
      expect(byId(report, "migrations.history").detail).toMatch(/013/);
      expect(report.ok).toBe(false);
    } finally {
      await env.adminPool.query("UPDATE schema_migrations SET checksum = (SELECT checksum FROM schema_migrations WHERE version='012') WHERE version='013'");
      // ripristino esatto: ricalcola dal testo reale
      const { createHash } = await import("node:crypto");
      const real = migrations.find((m) => m.version === "013")!;
      await env.adminPool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='013'", [createHash("sha256").update(real.sql, "utf8").digest("hex")]);
    }
    expect((await verifyPostgresReadOnly(env.runtimePool, options())).ok).toBe(true);
  });

  it("migrazione pendente (codice più nuovo del database) → FALLISCE senza applicarla", async () => {
    const newer = [...migrations, { version: "014", name: "014_futura.sql", sql: "SELECT 1;" }];
    const report = await verifyPostgresReadOnly(env.runtimePool, { ...options(), migrations: newer });
    expect(byId(report, "migrations.pending").status).toBe("fail");
    expect(byId(report, "migrations.pending").detail).toMatch(/014/);
    const applied = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM schema_migrations");
    expect(applied.rows[0]!.n).toBe(13); // niente è stato applicato
  });

  it("privilegio distruttivo concesso al ruolo runtime (es. UPDATE su audit_logs) → FALLISCE", async () => {
    await env.adminPool.query(`GRANT UPDATE ON audit_logs TO "${env.runtimeRole}"`);
    try {
      const report = await verifyPostgresReadOnly(env.runtimePool, options());
      expect(byId(report, "role.forbidden_privileges").status).toBe("fail");
      expect(byId(report, "role.forbidden_privileges").detail).toMatch(/audit_logs:UPDATE/);
    } finally {
      await env.adminPool.query(`REVOKE UPDATE ON audit_logs FROM "${env.runtimeRole}"`);
    }
    expect((await verifyPostgresReadOnly(env.runtimePool, options())).ok).toBe(true);
  });

  it("RLS disattivata o policy mancante su una tabella tenant → FALLISCE", async () => {
    await env.adminPool.query("ALTER TABLE events DISABLE ROW LEVEL SECURITY");
    try {
      const report = await verifyPostgresReadOnly(env.runtimePool, options());
      expect(byId(report, "rls.tenant_tables").status).toBe("fail");
      expect(byId(report, "rls.tenant_tables").detail).toMatch(/events: RLS disattivata/);
    } finally {
      await env.adminPool.query("ALTER TABLE events ENABLE ROW LEVEL SECURITY");
    }
    await env.adminPool.query("DROP POLICY tenant_isolation ON customers");
    try {
      expect(byId(await verifyPostgresReadOnly(env.runtimePool, options()), "rls.tenant_tables").detail).toMatch(/customers: policy tenant_isolation mancante/);
    } finally {
      await env.adminPool.query(`CREATE POLICY tenant_isolation ON customers
        USING (organization_id::text = NULLIF(current_setting('app.current_organization_id', true), ''))
        WITH CHECK (organization_id::text = NULLIF(current_setting('app.current_organization_id', true), ''))`);
    }
  });

  it("senza TLS: FALLISCE per impostazione predefinita (Neon richiede sslmode=verify-full), avviso con --allow-no-ssl", async () => {
    const strict = await verifyPostgresReadOnly(env.runtimePool, { ...options(), requireSsl: true });
    expect(byId(strict, "transport.tls").status).toBe(env.runtimePool.options.ssl ? "pass" : "fail");
    const relaxed = await verifyPostgresReadOnly(env.runtimePool, { ...options(), requireSsl: false });
    expect(byId(relaxed, "transport.tls").status).toBe("warn");
  });

  it("segnala l'endpoint pooler Neon senza riportare l'host per esteso; stime righe da catalogo", async () => {
    const report = await verifyPostgresReadOnly(env.runtimePool, { ...options(), connectionHost: "ep-cool-123456-pooler.eu-central-1.aws.neon.tech", includeEstimates: true });
    expect(byId(report, "transport.pooler").status).toBe("warn");
    expect(JSON.stringify(report)).not.toContain("ep-cool-123456");
    expect(report.estimates?.map((e) => e.table)).toContain("customers");
  });
});
