import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FunnelStep } from "../api";
import { FunnelFlow, biggestLoss } from "./FunnelFlow";

const funnel: FunnelStep[] = [
  { stage: "visit", label: "Visita", count: 300, conversionFromPrevious: 100, conversionFromVisit: 100 },
  { stage: "lead", label: "Contatto", count: 162, conversionFromPrevious: 54, conversionFromVisit: 54 },
  { stage: "qualified", label: "Qualificato", count: 94, conversionFromPrevious: 58, conversionFromVisit: 31 },
  { stage: "customer", label: "Cliente", count: 22, conversionFromPrevious: 23.4, conversionFromVisit: 7.3 },
];

describe("FunnelFlow", () => {
  afterEach(cleanup);

  it("individua il passaggio con la perdita maggiore", () => {
    expect(biggestLoss(funnel)).toEqual({ from: "Qualificato", to: "Cliente", loss: 76.6 });
  });

  it("non inventa perdite quando tutti i clienti passano alla fase successiva o la fase precedente è vuota", () => {
    expect(biggestLoss([
      { stage: "visit", label: "Visita", count: 10, conversionFromPrevious: 100, conversionFromVisit: 100 },
      { stage: "lead", label: "Contatto", count: 10, conversionFromPrevious: 100, conversionFromVisit: 100 },
    ])).toBeNull();
    expect(biggestLoss([
      { stage: "visit", label: "Visita", count: 0, conversionFromPrevious: 0, conversionFromVisit: 0 },
      { stage: "lead", label: "Contatto", count: 0, conversionFromPrevious: 0, conversionFromVisit: 0 },
    ])).toBeNull();
  });

  it("mostra la frase con la perdita maggiore, i conteggi di ogni fase e le perdite tra le fasi", () => {
    render(<FunnelFlow funnel={funnel} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("da Qualificato a Cliente");
    for (const label of ["Visita", "Contatto", "Qualificato", "Cliente"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("−46%")).toBeTruthy(); // perdita da Visita a Contatto
  });

  it("espone il grafico agli screen reader con un riepilogo testuale", () => {
    render(<FunnelFlow funnel={funnel} />);
    const figure = screen.getByRole("img");
    expect(figure.getAttribute("aria-label")).toBe("Percorso di conversione. Visita: 300, Contatto: 162, Qualificato: 94, Cliente: 22");
  });

  it("non disegna nulla con meno di due fasi", () => {
    const { container } = render(<FunnelFlow funnel={[funnel[0]!]} />);
    expect(container.innerHTML).toBe("");
  });
});
