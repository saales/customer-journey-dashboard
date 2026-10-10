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
    expect(await res.json()).toEqual({ status: "ok" });
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

  it("rifiuta un intervallo invertito con 400", async () => {
    const res = await fetch(`${base}/api/channels?from=2026-05-01&to=2026-01-01`);
    expect(res.status).toBe(400);
  });
});
