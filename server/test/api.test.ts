import Database from "better-sqlite3";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { initSchema } from "../src/db.js";
import { seedIfEmpty } from "../src/seed.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const db = new Database(":memory:");
  initSchema(db);
  seedIfEmpty(db, { customers: 500 });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("API", () => {
  it("risponde allo health check", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      database: "connected",
    });
  });

  it("gestisce una nuova organizzazione senza dati", async () => {
    const emptyDb = new Database(":memory:");
    initSchema(emptyDb);
    const emptyServer = createApp(emptyDb).listen(0);
    await new Promise((resolve) => emptyServer.once("listening", resolve));
    const emptyBase = `http://127.0.0.1:${(emptyServer.address() as AddressInfo).port}`;

    try {
      const meta = await (await fetch(`${emptyBase}/api/meta`)).json();
      expect(meta.minDate).toBeNull();
      expect(meta.maxDate).toBeNull();

      const summaryRes = await fetch(`${emptyBase}/api/summary`);
      const summary = await summaryRes.json();
      expect(summaryRes.status).toBe(200);
      expect(summary.kpis).toMatchObject({
        visits: 0,
        leads: 0,
        customers: 0,
        conversionRate: 0,
        avgDaysToCustomer: null,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        emptyServer.close((error) => error ? reject(error) : resolve());
      });
      emptyDb.close();
    }
  });

  it("restituisce funnel e KPI coerenti", async () => {
    const res = await fetch(`${base}/api/summary`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.funnel).toHaveLength(5);
    expect(body.kpis.visits).toBe(500);
    expect(body.kpis.customers).toBeLessThanOrEqual(body.kpis.leads);
  });

  it("filtra per canale", async () => {
    const all = await (await fetch(`${base}/api/summary`)).json();
    const email = await (await fetch(`${base}/api/summary?channel=Email`)).json();
    expect(email.kpis.visits).toBeLessThan(all.kpis.visits);
  });

  it("rifiuta un canale non valido con 400", async () => {
    const res = await fetch(`${base}/api/summary?channel=Inesistente`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Canale non valido/);
  });

  it("rifiuta date malformate con 400", async () => {
    const res = await fetch(`${base}/api/summary?from=ieri&to=oggi`);
    expect(res.status).toBe(400);
  });

  it("restituisce valori a zero se il periodo non contiene dati", async () => {
    const res = await fetch(`${base}/api/summary?from=2020-01-01&to=2020-02-01`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.kpis).toMatchObject({ visits: 0, customers: 0, conversionRate: 0, avgDaysToCustomer: null });
  });

  it("restituisce un 404 JSON per rotte /api inesistenti", async () => {
    const res = await fetch(`${base}/api/non-esiste`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Risorsa non trovata." });
  });

  it("imposta gli header di sicurezza e nasconde x-powered-by", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("rifiuta un intervallo invertito con 400", async () => {
    const res = await fetch(`${base}/api/channels?from=2026-05-01&to=2026-01-01`);
    expect(res.status).toBe(400);
  });

  it("restituisce i clienti paginati con i relativi eventi", async () => {
    const res = await fetch(`${base}/api/customers`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(50);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 500,
      totalPages: 10,
    });

    const firstCustomer = body.data[0];
    expect(firstCustomer).toHaveProperty("id");
    expect(firstCustomer).toHaveProperty("channel");
    expect(firstCustomer).toHaveProperty("createdAt");
    expect(Array.isArray(firstCustomer.events)).toBe(true);
    expect(firstCustomer.events[0].stage).toBe("visit");
  });

  it("supporta pagine successive e limita la dimensione massima", async () => {
    const firstPage = await (await fetch(`${base}/api/customers?page=1&limit=100`)).json();
    const res = await fetch(`${base}/api/customers?page=2&limit=100`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(100);
    expect(body.pagination).toMatchObject({
      page: 2,
      limit: 100,
      total: 500,
      totalPages: 5,
    });
    expect(body.data[0].id).toBeLessThan(firstPage.data[99].id);
  });

  it("rifiuta parametri di paginazione non validi", async () => {
    const res = await fetch(`${base}/api/customers?page=0&limit=500`);
    expect(res.status).toBe(400);
  });

  it("crea un cliente con i suoi eventi", async () => {
  const before = await (await fetch(`${base}/api/summary`)).json();

  const res = await fetch(`${base}/api/customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "Email",
      createdAt: "2026-11-06",
      events: [
        {
          stage: "lead",
          occurredAt: "2026-11-08",
        },
        {
          stage: "qualified",
          occurredAt: "2026-11-12",
        },
      ],
    }),
  });

  const created = await res.json();

  expect(created.id).toBeGreaterThan(0);

  expect(res.status).toBe(201);
  expect(created.id).toBeGreaterThan(0);
  expect(created.channel).toBe("Email");
  expect(created.events).toHaveLength(3);
  expect(created.events[0].stage).toBe("visit");

  const after = await (await fetch(`${base}/api/summary`)).json();

  expect(after.kpis.visits).toBe(before.kpis.visits + 1);
});
it("modifica un cliente e sostituisce i suoi eventi", async () => {
  const createRes = await fetch(`${base}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "Email",
      createdAt: "2026-11-06",
      events: [
        { stage: "lead", occurredAt: "2026-11-08" },
      ],
    }),
  });

  const created = await createRes.json();

  const updateRes = await fetch(`${base}/api/customers/${created.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "Social",
      createdAt: "2026-11-07",
      events: [
        { stage: "lead", occurredAt: "2026-11-09" },
        { stage: "qualified", occurredAt: "2026-11-12" },
      ],
    }),
  });

  const updated = await updateRes.json();

  expect(updateRes.status).toBe(200);
  expect(updated.id).toBe(created.id);
  expect(updated.channel).toBe("Social");
  expect(updated.createdAt).toBe("2026-11-07");
  expect(updated.events).toHaveLength(3);
  expect(updated.events[0].stage).toBe("visit");
  expect(updated.events[1].stage).toBe("lead");
  expect(updated.events[2].stage).toBe("qualified");
});
it("elimina un cliente e i suoi eventi", async () => {
  const createRes = await fetch(`${base}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "Email",
      createdAt: "2026-11-06",
      events: [
        { stage: "lead", occurredAt: "2026-11-08" },
      ],
    }),
  });

  const created = await createRes.json();

  const deleteRes = await fetch(`${base}/api/customers/${created.id}`, {
    method: "DELETE",
  });

  expect(deleteRes.status).toBe(204);

  const customersRes = await fetch(`${base}/api/customers`);
  const customers = await customersRes.json();

  expect(customers.data.some((customer: { id: number }) => customer.id === created.id)).toBe(false);
});


  it("importa i dati CSV, impedisce i duplicati e rifiuta dati non validi", async () => {
    const validRows = [
      { externalId: "IMP001", channel: "Organico", createdAt: "2098-01-10", stage: "visit", occurredAt: "2098-01-10" },
      { externalId: "IMP001", channel: "Organico", createdAt: "2098-01-10", stage: "lead", occurredAt: "2098-01-12" },
      { externalId: "IMP001", channel: "Organico", createdAt: "2098-01-10", stage: "qualified", occurredAt: "2098-01-18" },
      { externalId: "IMP002", channel: "Social", createdAt: "2098-01-15", stage: "visit", occurredAt: "2098-01-15" },
      { externalId: "IMP002", channel: "Social", createdAt: "2098-01-15", stage: "lead", occurredAt: "2098-01-20" },
      { externalId: "IMP002", channel: "Social", createdAt: "2098-01-15", stage: "customer", occurredAt: "2098-02-10" },
      { externalId: "IMP003", channel: "Email", createdAt: "2098-02-03", stage: "visit", occurredAt: "2098-02-03" },
      { externalId: "IMP003", channel: "Email", createdAt: "2098-02-03", stage: "lead", occurredAt: "2098-02-05" },
    ];

    const customersBefore = await (
      await fetch(`${base}/api/customers`)
    ).json();

    const payload = {
      fileName: "import-test.csv",
      rows: validRows,
    };

    // 1. Importazione valida
    const importRes = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const imported = await importRes.json();

    expect(importRes.status).toBe(201);
    expect(imported.importedCustomers).toBe(3);
    expect(imported.importedRows).toBe(8);
    expect(imported.importedEvents).toBe(8);

    // 2. Lo stesso contenuto non deve essere importato due volte
    const duplicateRes = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(duplicateRes.status).toBe(409);

    // 3. Un canale non valido deve bloccare l'importazione
    const invalidRes = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "import-non-valido.csv",
        rows: [
          ...validRows,
          {
            externalId: "IMP004",
            channel: "Canale inesistente",
            createdAt: "2098-03-01",
            stage: "visit",
            occurredAt: "2098-03-01",
          },
        ],
      }),
    });

    expect(invalidRes.status).toBe(400);

    // Nessun cliente deve essere stato aggiunto dai tentativi rifiutati
    const customersAfter = await (
      await fetch(`${base}/api/customers`)
    ).json();

    expect(customersAfter.pagination.total).toBe(customersBefore.pagination.total + 3);
  });


});
