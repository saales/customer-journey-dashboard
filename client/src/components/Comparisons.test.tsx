import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Comparisons } from "./Comparisons";

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}
const summary = { funnel: [], kpis: { visits: 100, leads: 50, customers: 10, conversionRate: 10, avgDaysToCustomer: 12 } };
const channels = [{ channel: "Email", visits: 40, leads: 20, customers: 4, visitToLead: 50, visitToCustomer: 10 }];
const segments = { totalCustomers: 10, channels: [], stages: [], periods: [], combinations: [] };

describe("Comparisons", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("passa da caricamento a dati disponibili senza errori sugli Hook", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).startsWith("/api/summary")) return json(summary);
      if (String(url).startsWith("/api/channels")) return json(channels);
      if (String(url).startsWith("/api/segments")) return json(segments);
      return json({});
    }));
    render(<Comparisons query={{ from: "2026-01-01", to: "2026-03-31" }} />);
    expect(screen.getByText(/Caricamento dei confronti/)).toBeTruthy();
    expect(await screen.findByText("Confronto tra periodi")).toBeTruthy();
    expect(errors.filter((e) => String(e).includes("Hooks"))).toEqual([]);
    spy.mockRestore();
  });

  it("gestisce passaggi tra query nulla e intervallo valido sullo stesso componente", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).startsWith("/api/summary")) return json(summary);
      if (String(url).startsWith("/api/channels")) return json(channels);
      return json(segments);
    }));
    const { rerender } = render(<Comparisons query={null} />);
    expect(screen.getByText(/Seleziona un intervallo di date valido/)).toBeTruthy();
    rerender(<Comparisons query={{ from: "2026-01-01", to: "2026-03-31" }} />);
    expect(await screen.findByText("Confronto tra periodi")).toBeTruthy();
    rerender(<Comparisons query={null} />);
    expect(screen.getByText(/Seleziona un intervallo di date valido/)).toBeTruthy();
  });
});
