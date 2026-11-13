import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { DataImport } from "./DataImport";

vi.mock("../api", () => ({
  api: {
    funnelStages: vi.fn(),
    importCsv: vi.fn(),
  },
}));

const stages = [
  { id: "visit", label: "Visita", position: 0, isActive: true, isSystem: true },
  { id: "customer", label: "Cliente", position: 1, isActive: true, isSystem: true },
];

function selectCsv(contents: string) {
  const file = new File([contents], "clienti.csv", { type: "text/csv" });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Input file non trovato");
  fireEvent.change(input, { target: { files: [file] } });
}

const header = "externalId,channel,createdAt,stage,occurredAt";

beforeEach(() => {
  vi.mocked(api.funnelStages).mockResolvedValue(stages);
  vi.mocked(api.importCsv).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Validazione preventiva importazione", () => {
  it("segnala identificativi cliente oltre 100 caratteri prima dell'invio", async () => {
    render(<DataImport onDataChange={vi.fn()} />);
    await screen.findByText(/Seleziona un file CSV o Excel/);

    selectCsv([
      header,
      `${"x".repeat(101)},Organico,2026-01-01,visit,2026-01-01`,
    ].join("\n"));

    expect(await screen.findByText(/Identificativo cliente troppo lungo: massimo 100 caratteri/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Importa dati" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.importCsv).not.toHaveBeenCalled();
  });

  it("blocca file con più di 10.000 righe prima di creare l'anteprima", async () => {
    render(<DataImport onDataChange={vi.fn()} />);
    await screen.findByText(/Seleziona un file CSV o Excel/);

    const rows = Array.from(
      { length: 10_001 },
      (_, index) => `crm-${index},Organico,2026-01-01,visit,2026-01-01`,
    );
    selectCsv([header, ...rows].join("\n"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "il limite massimo è 10000",
    );
    expect(screen.queryByText("Anteprima e correzione dati")).toBeNull();
    expect(api.importCsv).not.toHaveBeenCalled();
  });
});
