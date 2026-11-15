import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { exportPostgresOrganizationJson } from "../src/postgres-export-repository.js";
import {
  createHttpTestEnvironment, integrationDatabaseUrl, ROLES, type HttpTestEnvironment,
} from "./helpers/http-test-environment.js";

const dbUrl = integrationDatabaseUrl();
/** Organizzazione isolata per i test di snapshot del repository export. */
async function makeExportOrg(slug: string) {
  const org = await env.adminPool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1,$1) RETURNING id::text AS id", [slug],
  );
  const id = org.rows[0]!.id;
  await env.adminPool.query(
    "INSERT INTO funnel_stages (organization_id,id,label,position,is_system) VALUES ($1,'visit','Visita',0,TRUE),($1,'lead','Lead',1,TRUE)", [id],
  );
  const user = await env.adminPool.query<{ id: string }>(
    "INSERT INTO users (email,password_hash,full_name) VALUES ($1,'x','Admin') RETURNING id::text AS id", [`${slug}@example.test`],
  );
  await env.adminPool.query("INSERT INTO memberships (organization_id,user_id,role) VALUES ($1,$2,'admin')", [id,user.rows[0]!.id]);
  return {
    id, userId:user.rows[0]!.id,
    drop:async()=>{
      await env.adminPool.query("DELETE FROM events WHERE organization_id=$1",[id]);
      await env.adminPool.query("DELETE FROM organizations WHERE id=$1",[id]);
    },
  };
}

let env: HttpTestEnvironment;

beforeAll(async () => { if (dbUrl) env = await createHttpTestEnvironment(); }, 60_000);
afterAll(async () => { await env?.close(); });

describe.skipIf(!dbUrl)("Export JSON organizzazione: permessi, contenuto, audit e limiti", () => {
  const token = (role: typeof ROLES[number]) => env.tenants.A.users[role].token;

  it.each(ROLES)("ruolo %s: solo admin/editor/analyst possono esportare", async (role) => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token(role) });
    expect(response.status).toBe(role === "viewer" ? 403 : 200);
  });

  it("senza sessione risponde 401", async () => {
    expect((await env.request("GET", "/api/export/organization.json")).status).toBe(401);
  });

  it("restituisce JSON scaricabile senza cache e con schemaVersion stabile", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      organization: { slug: "tenant-a" },
      funnelStages: expect.any(Array),
      customers: expect.any(Array),
      importBatches: expect.any(Array),
    });
  });

  it("non include dati del tenant B né credenziali, token o sessioni", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("tenant-b");
    expect(response.text).not.toContain("only-b-2");
    expect(response.text).not.toContain("password_hash");
    expect(response.text).not.toContain("token_hash");
    expect(response.text).not.toContain("session_token");
    expect(response.text).not.toContain(env.tenants.B.id);
  });

  it("ogni export riuscito produce una sola voce audit nel tenant A", async () => {
    const beforeA = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    const beforeB = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.B.id]);
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    const afterA = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    const afterB = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.B.id]);
    expect(afterA.rows[0]!.n).toBe(beforeA.rows[0]!.n + 1);
    expect(afterB.rows).toEqual(beforeB.rows);
  });

  it("un export negato non crea una voce audit", async () => {
    const before = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    const response = await env.request("GET", "/api/export/organization.json", { token: token("viewer") });
    expect(response.status).toBe(403);
    const after = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'", [env.tenants.A.id]);
    expect(after.rows).toEqual(before.rows);
  });

  it("gli eventi nel JSON sono ordinati cronologicamente per cliente", async () => {
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    const body = response.body as { customers: { events: { occurredAt: string }[] }[] };
    for (const customer of body.customers) {
      const dates = customer.events.map(event => event.occurredAt);
      expect(dates).toEqual([...dates].sort());
    }
  });

  it("l'export non modifica il numero di clienti o eventi", async () => {
    const before = await env.adminPool.query(
      "SELECT (SELECT COUNT(*)::int FROM customers WHERE organization_id=$1) AS customers, (SELECT COUNT(*)::int FROM events WHERE organization_id=$1) AS events",
      [env.tenants.A.id],
    );
    const response = await env.request("GET", "/api/export/organization.json", { token: token("admin") });
    expect(response.status).toBe(200);
    const after = await env.adminPool.query(
      "SELECT (SELECT COUNT(*)::int FROM customers WHERE organization_id=$1) AS customers, (SELECT COUNT(*)::int FROM events WHERE organization_id=$1) AS events",
      [env.tenants.A.id],
    );
    expect(after.rows).toEqual(before.rows);
  });
});


describe.skipIf(!dbUrl)("Export JSON — snapshot concorrente REPEATABLE READ", () => {
  /** Inietta una scrittura committata da un'altra connessione dopo una query precisa. */
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

  it("le scritture committate durante l'export non entrano nello snapshot e il successivo export le vede", async () => {
    const org = await makeExportOrg("snapshot-json");
    try {
      const first = await env.adminPool.query<{id:string}>(
        "INSERT INTO customers (organization_id,external_id,channel,created_at) VALUES ($1,'iniziale','Email','2026-01-01') RETURNING id::text AS id",[org.id],
      );
      await env.adminPool.query(
        "INSERT INTO events (organization_id,customer_id,stage_id,occurred_at) VALUES ($1,$2::bigint,'visit','2026-01-01')",[org.id,first.rows[0]!.id],
      );
      const racing = poolWithConcurrentWrite(/FROM funnel_stages/, async () => {
        const late = await env.adminPool.query<{id:string}>(
          "INSERT INTO customers (organization_id,external_id,channel,created_at) VALUES ($1,'tardivo','Social','2026-02-02') RETURNING id::text AS id",[org.id],
        );
        await env.adminPool.query(
          "INSERT INTO events (organization_id,customer_id,stage_id,occurred_at) VALUES ($1,$2::bigint,'visit','2026-02-02'),($1,$2::bigint,'lead','2026-02-03')",[org.id,late.rows[0]!.id],
        );
        await env.adminPool.query(
          "INSERT INTO import_batches (organization_id,fingerprint,file_name,customer_count,row_count) VALUES ($1,'late','late.csv',1,2)",[org.id],
        );
        await env.adminPool.query("UPDATE organizations SET name='Rinominata durante export' WHERE id=$1",[org.id]);
        await env.adminPool.query("UPDATE funnel_stages SET label='Etichetta tardiva' WHERE organization_id=$1 AND id='lead'",[org.id]);
      });
      const snapshot = await exportPostgresOrganizationJson(racing,org.id,org.userId);
      expect(snapshot.customers).toHaveLength(1);
      expect(snapshot.customers[0]!.events).toHaveLength(1);
      expect(snapshot.importBatches).toEqual([]);
      expect(snapshot.organization.name).toBe("snapshot-json");
      expect(snapshot.funnelStages.find(s=>s.id==="lead")!.label).toBe("Lead");
      const after = await exportPostgresOrganizationJson(env.runtimePool,org.id,org.userId);
      expect(after.customers).toHaveLength(2);
      expect(after.customers.reduce((n,customer)=>n+customer.events.length,0)).toBe(3);
      expect(after.importBatches).toHaveLength(1);
      expect(after.organization.name).toBe("Rinominata durante export");
    } finally { await org.drop(); }
  },60_000);


  it("accetta esattamente 100.000 record esportabili per risorsa", async () => {
    const org = await makeExportOrg("export-exact-limit");
    try {
      await env.adminPool.query(
        "INSERT INTO import_batches (organization_id,fingerprint,file_name,customer_count,row_count) SELECT $1,md5(g::text),'boundary.csv',0,0 FROM generate_series(1,100000) g",
        [org.id],
      );
      const exported = await exportPostgresOrganizationJson(env.runtimePool, org.id, org.userId);
      expect(exported.importBatches).toHaveLength(100_000);
      const audit = await env.adminPool.query(
        "SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'",
        [org.id],
      );
      expect(audit.rows[0]!.n).toBe(1);
    } finally {
      await org.drop();
    }
  }, 120_000);

  it("un errore a metà export esegue rollback e non lascia connessioni in transazione", async () => {
    const org = await makeExportOrg("snapshot-rollback");
    try {
      await env.adminPool.query(
        "INSERT INTO import_batches (organization_id,fingerprint,file_name,customer_count,row_count) SELECT $1,'f'||g,'f.csv',0,0 FROM generate_series(1,100001) g",[org.id],
      );
      await expect(exportPostgresOrganizationJson(env.runtimePool,org.id,org.userId)).rejects.toMatchObject({status:413});
      const audit = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND action='data.exported'",[org.id]);
      expect(audit.rows[0]!.n).toBe(0);
      expect(env.runtimePool.waitingCount).toBe(0);
      const idle = await env.adminPool.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'");
      expect(idle.rows[0]!.n).toBe(0);
    } finally { await org.drop(); }
  },120_000);
});
