import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initSchema, type Db } from "../src/db.js";
import { getAvgDaysToCustomer, getChannels, getFunnel, getTimeseries } from "../src/queries.js";

/**
 * Dati di prova:
 *  1 Email    visita 01/01 → lead 02/01 → cliente 11/01
 *  2 Email    visita 05/01 → lead 06/01
 *  3 Social   visita 10/01
 *  4 Social   visita 15/02 → lead 16/02
 */
let db: Db;

function add(id: number, channel: string, created: string, events: [string, string][]) {
  db.prepare("INSERT INTO customers (id, channel, created_at) VALUES (?, ?, ?)").run(id, channel, created);
  db.prepare("INSERT INTO events (customer_id, stage, occurred_at) VALUES (?, 'visit', ?)").run(id, created);
  for (const [stage, date] of events) {
    db.prepare("INSERT INTO events (customer_id, stage, occurred_at) VALUES (?, ?, ?)").run(id, stage, date);
  }
}

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  add(1, "Email", "2026-01-01", [["lead", "2026-01-02"], ["customer", "2026-01-11"]]);
  add(2, "Email", "2026-01-05", [["lead", "2026-01-06"]]);
  add(3, "Social", "2026-01-10", []);
  add(4, "Social", "2026-02-15", [["lead", "2026-02-16"]]);
});

const all = { from: "2026-01-01", to: "2026-12-31" };

describe("getFunnel", () => {
  it("conta i clienti unici per stadio", () => {
    const funnel = getFunnel(db, all);
    expect(funnel.map((s) => s.count)).toEqual([4, 3, 0, 0, 1]);
  });

  it("calcola le conversioni rispetto allo stadio precedente e alle visite", () => {
    const [visit, lead] = getFunnel(db, all);
    expect(visit.conversionFromPrevious).toBe(100);
    expect(lead.conversionFromPrevious).toBe(75);
    expect(lead.conversionFromVisit).toBe(75);
  });

  it("rispetta il filtro per canale", () => {
    const funnel = getFunnel(db, { ...all, channel: "Email" });
    expect(funnel.map((s) => s.count)).toEqual([2, 2, 0, 0, 1]);
  });

  it("rispetta il filtro per periodo (coorte di gennaio)", () => {
    const funnel = getFunnel(db, { from: "2026-01-01", to: "2026-01-31" });
    expect(funnel[0].count).toBe(3);
  });

  it("restituisce zeri se il periodo non contiene dati", () => {
    const funnel = getFunnel(db, { from: "2025-01-01", to: "2025-01-31" });
    expect(funnel.every((s) => s.count === 0 && s.conversionFromVisit === 0)).toBe(true);
  });
});

describe("getChannels", () => {
  it("ordina i canali per conversione visita → cliente", () => {
    const rows = getChannels(db, all);
    expect(rows[0]).toMatchObject({ channel: "Email", visits: 2, leads: 2, customers: 1, visitToCustomer: 50 });
    expect(rows[1]).toMatchObject({ channel: "Social", visits: 2, leads: 1, customers: 0 });
  });
});

describe("getTimeseries", () => {
  it("raggruppa per mese di prima visita", () => {
    const series = getTimeseries(db, all);
    expect(series).toEqual([
      { month: "2026-01", visits: 3, customers: 1, conversion: 33.3 },
      { month: "2026-02", visits: 1, customers: 0, conversion: 0 },
    ]);
  });
});

describe("getAvgDaysToCustomer", () => {
  it("misura i giorni tra prima visita e acquisto", () => {
    expect(getAvgDaysToCustomer(db, all)).toBe(10);
  });

  it("restituisce null se nessuno è diventato cliente", () => {
    expect(getAvgDaysToCustomer(db, { ...all, channel: "Social" })).toBeNull();
  });
});
