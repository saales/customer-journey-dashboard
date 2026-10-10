import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { startOfPeriod } from "./format";

const meta = { minDate: "2025-10-01", maxDate: "2026-09-30", channels: ["Organico", "Social", "Email"] };

const summary = {
  funnel: [
    { stage: "visit", label: "Visita", count: 1000, conversionFromPrevious: 100, conversionFromVisit: 100 },
    { stage: "lead", label: "Lead", count: 200, conversionFromPrevious: 20, conversionFromVisit: 20 },
    { stage: "qualified", label: "Qualificato", count: 100, conversionFromPrevious: 50, conversionFromVisit: 10 },
    { stage: "opportunity", label: "Opportunità", count: 50, conversionFromPrevious: 50, conversionFromVisit: 5 },
    { stage: "customer", label: "Cliente", count: 20, conversionFromPrevious: 40, conversionFromVisit: 2 },
  ],
  kpis: { visits: 12345, leads: 200, customers: 20, conversionRate: 2, avgDaysToCustomer: 31.5 },
};

const channels = [
  { channel: "Email", visits: 400, leads: 100, customers: 12, visitToLead: 25, visitToCustomer: 3 },
  { channel: "Social", visits: 600, leads: 100, customers: 8, visitToLead: 16.7, visitToCustomer: 1.3 },
];

const timeseries = [
  { month: "2026-08", visits: 80, customers: 2, conversion: 2.5 },
  { month: "2026-09", visits: 90, customers: 3, conversion: 3.3 },
];

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/meta")) return json(meta);
    if (url.startsWith("/api/summary")) return json(summary);
    if (url.startsWith("/api/channels")) return json(channels);
    if (url.startsWith("/api/timeseries")) return json(timeseries);
    return json({ error: "non trovato" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("mostra KPI, tabella dei canali e avviso sui dati sintetici", async () => {
    render(<App />);
    expect(await screen.findByText("Conversione visita → cliente")).toBeTruthy();
    expect(screen.getByText("12.345")).toBeTruthy(); // visite formattate in italiano
    expect(screen.getByText("31,5")).toBeTruthy(); // giorni medi con la virgola
    expect(await screen.findByText("Confronto tra canali")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Email")).toBeTruthy();
    expect(screen.getByText(/Dati sintetici/)).toBeTruthy();
  });

  it("richiede i dati del periodo più recente (ultimi 12 mesi)", async () => {
    render(<App />);
    await screen.findByText("Conversione visita → cliente");
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/summary"))).toBe(true));
    const url = String(fetchMock.mock.calls.find(([u]) => String(u).includes("/api/summary"))![0]);
    expect(url).toContain("from=2025-10-01");
    expect(url).toContain("to=2026-09-30");
  });

  it("invia il canale scelto nel filtro", async () => {
    render(<App />);
    await screen.findByText("Conversione visita → cliente");
    fireEvent.change(screen.getByLabelText("Canale"), { target: { value: "Email" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/summary") && String(u).includes("channel=Email"))).toBe(true),
    );
  });

  it("mostra un messaggio se l'API risponde con un errore", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith("/api/meta") ? json(meta) : json({ error: "Errore di prova" }, 500),
    );
    render(<App />);
    expect(await screen.findByText(/Impossibile caricare i dati/)).toBeTruthy();
    expect(screen.getByText(/Errore di prova/)).toBeTruthy();
  });
});

describe("startOfPeriod", () => {
  it("calcola l'inizio di un periodo di N mesi interi che termina nel mese indicato", () => {
    expect(startOfPeriod("2026-09-30", 12)).toBe("2025-10-01");
    expect(startOfPeriod("2026-09-30", 6)).toBe("2026-04-01");
    expect(startOfPeriod("2026-09-30", 3)).toBe("2026-07-01");
  });

  it("funziona anche se l'ultima data cade a metà mese", () => {
    expect(startOfPeriod("2026-09-27", 3)).toBe("2026-07-01");
    expect(startOfPeriod("2026-01-15", 3)).toBe("2025-11-01");
  });
});
