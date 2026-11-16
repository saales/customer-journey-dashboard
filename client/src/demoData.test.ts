import { describe, expect, it } from "vitest";
import { buildDemoRows } from "./demoData";

describe("buildDemoRows", () => {
  const today = new Date("2026-11-15T10:00:00Z");
  const rows = buildDemoRows(today);

  it("è deterministico: stessi dati a parità di data", () => {
    expect(buildDemoRows(today)).toEqual(rows);
  });

  it("genera 240 clienti, ciascuno con la fase iniziale 'visit' nel giorno di ingresso", () => {
    const ids = new Set(rows.map((r) => r.externalId));
    expect(ids.size).toBe(240);
    for (const id of ids) {
      const own = rows.filter((r) => r.externalId === id);
      expect(own[0]!.stage).toBe("visit");
      expect(own[0]!.occurredAt).toBe(own[0]!.createdAt);
    }
  });

  it("non contiene date future né date in ordine non cronologico, e rispetta l'ordine delle fasi", () => {
    const order = ["visit", "lead", "qualified", "opportunity", "customer"];
    for (const id of new Set(rows.map((r) => r.externalId))) {
      const own = rows.filter((r) => r.externalId === id);
      expect(own.map((r) => r.stage)).toEqual(order.slice(0, own.length));
      for (let i = 1; i < own.length; i += 1) expect(own[i]!.occurredAt >= own[i - 1]!.occurredAt).toBe(true);
    }
    expect(rows.every((r) => r.occurredAt <= "2026-11-15")).toBe(true);
  });

  it("usa solo canali ammessi e il funnel si restringe", () => {
    const channels = new Set(rows.map((r) => r.channel));
    for (const channel of channels) expect(["Organico", "Social", "Email", "Advertising", "Referral"]).toContain(channel);
    const count = (stage: string) => rows.filter((r) => r.stage === stage).length;
    expect(count("visit")).toBeGreaterThan(count("lead"));
    expect(count("lead")).toBeGreaterThan(count("qualified"));
    expect(count("qualified")).toBeGreaterThan(count("customer"));
  });
});
