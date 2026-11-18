import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { exportPostgresOrganizationJson, type PostgresOrganizationExport } from "../src/postgres-export-repository.js";
import {
  createHttpTestEnvironment, integrationDatabaseUrl, ROLES,
  type HttpTestEnvironment,
} from "./helpers/http-test-environment.js";

/**
 * Export JSON dell'organizzazione (portabilità dati) su PostgreSQL reale:
 * permessi e intestazioni, isolamento tenant, contenuto e ordinamento
 * deterministici, limite di 100.000 righe per risorsa (con confine esatto),
 * assenza di audit sugli export rifiutati e snapshot coerente (REPEATABLE READ)
 * anche con scritture concorrenti durante l'esportazione.
 */

const MAX = 100_000;
const dbUrl = integrationDatabaseUrl();
let env: HttpTestEnvironment;

/** Organizzazione dedicata (con amministratore e sessione) per test che gonfiano i volumi. */
async function makeOrg(slug: string) {
  const org = await env.adminPool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1,$1) RETURNING id::text AS id", [slug]);
  const id = org.rows[0]!.id;
  await env.adminPool.query(
    "INSERT INTO funnel_stages (organization_id, id, label, position, is_system) VALUES ($1,'visit','Visita',0,TRUE),($1,'lead','Lead',1,TRUE)", [id]);
  const user = await env.adminPool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','Admin') RETURNING id::text AS id", [`${slug}@example.test`]);
  await env.adminPool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'admin')", [id, user.rows[0]!.id]);
  const token = await env.newSession(user.rows[0]!.id, id);
  return { id, userId: user.rows[0]!.id, token, // events -> funnel_stages è ON DELETE RESTRICT: gli eventi vanno eliminati prima dell'organizzazione.
    drop: async () => {
      await env.adminPool.query("DELETE FROM events WHERE organization_id=$1", [id]);
      await env.adminPool.query("DELETE FROM organizations WHERE id=$1", [id]);
    } };
}
const exportAudits = async (org: string) =>
  Number((await env.adminPool.query("SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [org])).rows[0]!.n);

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Export JSON — accesso, intestazioni e audit", () => {
  const get = (token?: string) => env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token });

  it.each(ROLES)("ruolo %s: ammesso solo admin/editor/analyst, viewer negato", async (role) => {
    const response = await get(env.tenants.A.users[role].token);
    expect(response.status).toBe(role === "viewer" ? 403 : 200);
  });

  it("senza sessione → 401 e nessun dato", async () => {
    const response = await get();
    expect(response.status).toBe(401);
    expect(response.text).not.toContain("customers");
  });

  it("intestazioni: JSON UTF-8, download come allegato, nessuna cache", async () => {
    const response = await get(env.tenants.A.users.admin.token);
    expect(response.headers.get("content-type")).toMatch(/^application\/json; charset=utf-8/i);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="percorso-organizzazione.json"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("ogni export riuscito scrive UNA voce di audit 'data.exported' con i conteggi, solo nel tenant esportato", async () => {
    const beforeA = await exportAudits(env.tenants.A.id);
    const beforeB = await exportAudits(env.tenants.B.id);
    const response = await get(env.tenants.A.users.analyst.token);
    expect(response.status).toBe(200);
    expect(await exportAudits(env.tenants.A.id)).toBe(beforeA + 1);
    expect(await exportAudits(env.tenants.B.id)).toBe(beforeB);
    const audit = await env.adminPool.query(
      "SELECT actor_user_id::text AS actor, resource_type, details FROM audit_logs WHERE organization_id=$1 AND action='data.exported' ORDER BY id DESC LIMIT 1", [env.tenants.A.id]);
    expect(audit.rows[0]).toEqual({
      actor: env.tenants.A.users.analyst.id, resource_type: "organization_export",
      details: { format: "json", customers: response.body.customers.length, funnelStages: response.body.funnelStages.length, importBatches: response.body.importBatches.length },
    });
  });

  it("gli export negati (403/401) non scrivono audit", async () => {
    const before = await exportAudits(env.tenants.A.id);
    await get(env.tenants.A.users.viewer.token);
    await get();
    expect(await exportAudits(env.tenants.A.id)).toBe(before);
  });
});

describe.skipIf(!dbUrl)("Export JSON — contenuto e isolamento tenant", () => {
  it("contiene solo i dati del tenant della sessione: nessun cliente, evento, fase o importazione di B", async () => {
    await env.adminPool.query(
      "INSERT INTO import_batches (organization_id, fingerprint, file_name, customer_count, row_count) VALUES ($1,'fp-b','solo-b.csv',2,4),($2,'fp-a','solo-a.csv',2,4)",
      [env.tenants.B.id, env.tenants.A.id]);
    await env.adminPool.query("INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'b-esclusivo','Referral','2026-03-03')", [env.tenants.B.id]);
    const a = await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token: env.tenants.A.users.admin.token });
    expect(a.status).toBe(200);
    expect(a.body.organization).toMatchObject({ id: env.tenants.A.id, slug: "tenant-a" });
    expect(a.body.customers.map((c) => c.id).sort()).toEqual([...env.tenants.A.customerIds].sort());
    expect(a.body.importBatches.map((b) => b.fileName)).toEqual(["solo-a.csv"]);
    for (const forbidden of ["b-esclusivo", "solo-b.csv", "fp-b", env.tenants.B.id, "tenant-b", "Tenant B", ".b@example.test"]) {
      expect(a.text, `compare "${forbidden}"`).not.toContain(forbidden);
    }
    const b = await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token: env.tenants.B.users.admin.token });
    expect(b.text).not.toContain(env.tenants.A.id);
    expect(b.text).not.toContain("solo-a.csv");
  });

  it("non espone credenziali, token, sessioni, membri, email o dati utente", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: env.tenants.A.users.admin.token });
    expect(Object.keys(response.body as object).sort()).toEqual(["customers", "funnelStages", "generatedAt", "importBatches", "organization", "schemaVersion"]);
    expect(response.text).not.toMatch(/password|token_hash|scrypt\$|@example\.test|memberships|invitations|sessions/i);
  });

  it("schema stabile: schemaVersion 1, date ISO UTC, eventi per cliente in ordine cronologico", async () => {
    const { body } = await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token: env.tenants.A.users.admin.token });
    expect(body.schemaVersion).toBe(1);
    expect(body.organization.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(body.funnelStages.map((s) => s.position)).toEqual([...body.funnelStages.map((s) => s.position)].sort((x, y) => x - y));
    for (const customer of body.customers) {
      expect(customer.createdAt).toMatch(/Z$/);
      const times = customer.events.map((e) => Date.parse(e.occurredAt));
      expect(times).toEqual([...times].sort((x, y) => x - y));
    }
  });

  it("deterministico: due export consecutivi sono identici tranne generatedAt", async () => {
    const token = env.tenants.A.users.admin.token;
    const one = (await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token })).body;
    const two = (await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token })).body;
    expect({ ...one, generatedAt: "" }).toEqual({ ...two, generatedAt: "" });
  });

  it("completo e fedele al database: stessi clienti ed eventi del tenant (round-trip)", async () => {
    const { body } = await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token: env.tenants.A.users.admin.token });
    const expectedEvents = (await env.adminPool.query("SELECT COUNT(*)::int AS n FROM events WHERE organization_id=$1", [env.tenants.A.id])).rows[0]!.n;
    expect(body.customers.reduce((sum, c) => sum + c.events.length, 0)).toBe(expectedEvents);
    const expectedCustomers = (await env.adminPool.query("SELECT COUNT(*)::int AS n FROM customers WHERE organization_id=$1", [env.tenants.A.id])).rows[0]!.n;
    expect(body.customers).toHaveLength(expectedCustomers);
  });
});

describe.skipIf(!dbUrl)("Export JSON — limiti (100.000 righe per risorsa)", () => {
  it("oltre il limite di CLIENTI → 413, messaggio sulla risorsa, nessun audit, nessun dato nel corpo", async () => {
    const org = await makeOrg("limite-clienti");
    try {
      await env.adminPool.query(
        "INSERT INTO customers (organization_id, external_id, channel, created_at) SELECT $1, 'c' || g, 'Email', NOW() FROM generate_series(1, $2) g", [org.id, MAX + 1]);
      const response = await env.request("GET", "/api/export/organization.json", { token: org.token });
      expect(response.status).toBe(413);
      expect(response.body).toEqual({ error: "Esportazione troppo ampia (clienti): suddividere i dati prima di riprovare." });
      expect(await exportAudits(org.id)).toBe(0);
      const csv = await env.request("GET", "/api/export/customers.csv", { token: org.token });
      expect(csv.status).toBe(413); // lo stesso limite vale per il CSV
      expect(await exportAudits(org.id)).toBe(0);
    } finally { await org.drop(); }
  }, 60_000);

  it("oltre il limite di EVENTI → 413 senza audit", async () => {
    const org = await makeOrg("limite-eventi");
    try {
      const customer = await env.adminPool.query<{ id: string }>(
        "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'solo','Email',NOW()) RETURNING id::text AS id", [org.id]);
      await env.adminPool.query(
        "INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) SELECT $1, $2::bigint, 'visit', NOW() + g * INTERVAL '1 second' FROM generate_series(1, $3) g",
        [org.id, customer.rows[0]!.id, MAX + 1]);
      const response = await env.request("GET", "/api/export/organization.json", { token: org.token });
      expect(response.status).toBe(413);
      expect((response.body as { error: string }).error).toContain("eventi");
      expect(await exportAudits(org.id)).toBe(0);
    } finally { await org.drop(); }
  }, 60_000);

  it("oltre il limite di IMPORTAZIONI → 413; esattamente 100.000 → 200 (confine incluso) con audit", async () => {
    const org = await makeOrg("limite-import");
    try {
      await env.adminPool.query(
        "INSERT INTO import_batches (organization_id, fingerprint, file_name, customer_count, row_count) SELECT $1, 'fp' || g, 'f.csv', 0, 0 FROM generate_series(1, $2) g", [org.id, MAX + 1]);
      const over = await env.request("GET", "/api/export/organization.json", { token: org.token });
      expect(over.status).toBe(413);
      expect((over.body as { error: string }).error).toContain("importazioni");
      expect(await exportAudits(org.id)).toBe(0);

      await env.adminPool.query("DELETE FROM import_batches WHERE organization_id=$1 AND fingerprint='fp1'", [org.id]); // ora 100.000 esatti
      const exact = await env.request<PostgresOrganizationExport>("GET", "/api/export/organization.json", { token: org.token });
      expect(exact.status).toBe(200);
      expect(exact.body.importBatches).toHaveLength(MAX);
      expect(await exportAudits(org.id)).toBe(1);
    } finally { await org.drop(); }
  }, 120_000);

  it("il limite di un tenant non influenza l'export degli altri", async () => {
    const heavy = await makeOrg("pesante");
    try {
      await env.adminPool.query(
        "INSERT INTO customers (organization_id, external_id, channel, created_at) SELECT $1, 'c' || g, 'Email', NOW() FROM generate_series(1, $2) g", [heavy.id, MAX + 1]);
      expect((await env.request("GET", "/api/export/organization.json", { token: heavy.token })).status).toBe(413);
      expect((await env.request("GET", "/api/export/organization.json", { token: env.tenants.B.users.admin.token })).status).toBe(200);
    } finally { await heavy.drop(); }
  }, 60_000);
});

describe.skipIf(!dbUrl)("Export JSON — snapshot coerente con scritture concorrenti", () => {
  /** Pool che esegue un effetto collaterale COMMITTATO da un'altra connessione dopo la prima query sui dati. */
  function poolWithConcurrentWrite(afterQueryMatching: RegExp, sideEffect: () => Promise<void>): Pick<Pool, "connect"> {
    let fired = false;
    return {
      connect: async () => {
        const client = await env.runtimePool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
          const result = await original(...args);
          const sql = typeof args[0] === "string" ? args[0] : "";
          if (!fired && afterQueryMatching.test(sql)) { fired = true; await sideEffect(); }
          return result;
        };
        return client as PoolClient;
      },
    } as Pick<Pool, "connect">;
  }

  it("scritture committate DURANTE l'export (cliente, eventi, importazione, nome, fase) non compaiono né producono dati incoerenti", async () => {
    const org = await makeOrg("snapshot");
    try {
      const first = await env.adminPool.query<{ id: string }>(
        "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'iniziale','Email','2026-01-01') RETURNING id::text AS id", [org.id]);
      await env.adminPool.query("INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit','2026-01-01')", [org.id, first.rows[0]!.id]);

      const racing = poolWithConcurrentWrite(/FROM funnel_stages/, async () => {
        const late = await env.adminPool.query<{ id: string }>(
          "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,'tardivo','Social','2026-02-02') RETURNING id::text AS id", [org.id]);
        await env.adminPool.query("INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit','2026-02-02'),($1,$2::bigint,'lead','2026-02-03')", [org.id, late.rows[0]!.id]);
        await env.adminPool.query("INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'lead','2026-01-05')", [org.id, first.rows[0]!.id]);
        await env.adminPool.query("INSERT INTO import_batches (organization_id, fingerprint, file_name, customer_count, row_count) VALUES ($1,'tardivo','tardivo.csv',1,2)", [org.id]);
        await env.adminPool.query("UPDATE organizations SET name='Rinominata durante export' WHERE id=$1", [org.id]);
        await env.adminPool.query("UPDATE funnel_stages SET label='Etichetta tardiva' WHERE organization_id=$1 AND id='lead'", [org.id]);
      });
      const snapshot = await exportPostgresOrganizationJson(racing, org.id, org.userId);

      // Lo snapshot è quello dell'inizio transazione: nessuna delle scritture concorrenti è visibile...
      expect(snapshot.customers).toHaveLength(1);
      expect(snapshot.customers[0]!.events).toHaveLength(1);
      expect(snapshot.importBatches).toEqual([]);
      expect(snapshot.organization.name).toBe("snapshot");
      expect(snapshot.funnelStages.find((s) => s.id === "lead")!.label).toBe("Lead");
      // ...e il documento è internamente coerente (ogni evento appartiene a un cliente presente).
      const customerIds = new Set(snapshot.customers.map((c) => c.id));
      const totalEvents = snapshot.customers.reduce((n, c) => n + c.events.length, 0);
      expect(totalEvents).toBe(1);
      expect(customerIds.size).toBe(snapshot.customers.length);

      // Prova controfattuale: le scritture sono davvero committate e un export successivo le vede.
      const after = await exportPostgresOrganizationJson(env.runtimePool, org.id, org.userId);
      expect(after.customers).toHaveLength(2);
      expect(after.customers.reduce((n, c) => n + c.events.length, 0)).toBe(4);
      expect(after.importBatches).toHaveLength(1);
      expect(after.organization.name).toBe("Rinominata durante export");
    } finally { await org.drop(); }
  });

  it("una cancellazione concorrente di un cliente non lascia eventi orfani nell'export", async () => {
    const org = await makeOrg("snapshot-delete");
    try {
      const rows = [] as string[];
      for (const name of ["x1", "x2", "x3"]) {
        const customer = await env.adminPool.query<{ id: string }>(
          "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1,$2,'Email','2026-01-01') RETURNING id::text AS id", [org.id, name]);
        rows.push(customer.rows[0]!.id);
        await env.adminPool.query("INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1,$2::bigint,'visit','2026-01-01')", [org.id, customer.rows[0]!.id]);
      }
      const racing = poolWithConcurrentWrite(/FROM customers c/, async () => {
        await env.adminPool.query("DELETE FROM customers WHERE id = $1::bigint", [rows[0]]);
      });
      const snapshot = await exportPostgresOrganizationJson(racing, org.id, org.userId);
      expect(snapshot.customers).toHaveLength(3); // lo snapshot precede la cancellazione
      expect(snapshot.customers.every((c) => c.events.length === 1)).toBe(true); // eventi coerenti coi clienti
    } finally { await org.drop(); }
  });

  it("l'export gira in una transazione REPEATABLE READ e si chiude con COMMIT (nessuna transazione lasciata aperta)", async () => {
    const statements: string[] = [];
    const spying = {
      connect: async () => {
        const client = await env.runtimePool.connect();
        const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
          if (typeof args[0] === "string") statements.push(args[0].replace(/\s+/g, " ").trim().slice(0, 60));
          return original(...args);
        };
        return client as PoolClient;
      },
    } as Pick<Pool, "connect">;
    await exportPostgresOrganizationJson(spying, env.tenants.A.id, env.tenants.A.users.admin.id);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(statements.at(-1)).toBe("COMMIT");
    const idle = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'");
    expect(idle.rows[0]!.n).toBe(0);
  });

  it("un errore a metà export (limite superato) fa ROLLBACK e rilascia la connessione al pool", async () => {
    const org = await makeOrg("rollback-export");
    try {
      await env.adminPool.query(
        "INSERT INTO import_batches (organization_id, fingerprint, file_name, customer_count, row_count) SELECT $1, 'f' || g, 'f.csv', 0, 0 FROM generate_series(1, $2) g", [org.id, MAX + 1]);
      await expect(exportPostgresOrganizationJson(env.runtimePool, org.id, org.userId)).rejects.toMatchObject({ status: 413 });
      expect(await exportAudits(org.id)).toBe(0);
      expect(env.runtimePool.waitingCount).toBe(0);
      const idle = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'");
      expect(idle.rows[0]!.n).toBe(0); // nessuna transazione lasciata aperta dopo l'errore
      expect((await env.request("GET", "/api/export/organization.json", { token: env.tenants.A.users.admin.token })).status).toBe(200);
    } finally { await org.drop(); }
  }, 60_000);
});
