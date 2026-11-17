import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmentation } from "./Segmentation";

function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function analysis(totalCustomers = 3, includeInactive = false) {
  return {
    totalCustomers,
    channels: [
      { id: "Social", label: "Social", customers: totalCustomers, share: 100, conversionRate: 0 },
      { id: "Organico", label: "Organico", customers: 0, share: 0, conversionRate: 0 },
    ],
    stages: [
      { id: "visit", label: "Visita", customers: 2, share: 66.7, conversionRate: 0 },
      ...(includeInactive
        ? [{ id: "inactive", label: "Fase disattivata", customers: 1, share: 33.3, conversionRate: 0 }]
        : []),
    ],
    periods: [],
    combinations: [],
  };
}

describe("Segmentation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("consente di cambiare il canale e ricarica l'analisi con il filtro selezionato", async () => {
    const requestedChannels: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/segments") {
        requestedChannels.push(url.searchParams.get("channel"));
        return json(analysis(url.searchParams.has("channel") ? 1 : 3));
      }
      return json([]);
    }));

    render(
      <Segmentation
        query={{ from: "2026-08-01", to: "2026-11-01", channel: "Social" }}
        channels={["Organico", "Social", "Email"]}
      />,
    );

    const channelSelect = await screen.findByRole("combobox", { name: "Canale di acquisizione" });
    expect((channelSelect as HTMLSelectElement).disabled).toBe(false);
    expect((channelSelect as HTMLSelectElement).value).toBe("Social");

    fireEvent.change(channelSelect, { target: { value: "" } });

    await waitFor(() => {
      expect(requestedChannels).toEqual(["Social", null]);
    });
  });

  it("il pulsante Aggiorna ripete la richiesta e segnala il caricamento", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/segments") {
        requests += 1;
        return json(analysis());
      }
      return json([]);
    }));

    render(
      <Segmentation
        query={{ from: "2026-08-01", to: "2026-11-01" }}
        channels={["Social"]}
      />,
    );

    const refreshButton = await screen.findByRole("button", { name: "Aggiorna segmentazione" });
    await waitFor(() => expect(requests).toBe(1));
    fireEvent.click(refreshButton);

    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(refreshButton.getAttribute("aria-busy")).toBe("false"));
  });

  it("mostra un feedback quando tutte le fasi sono già attive", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/segments") return json(analysis());
      return json([]);
    }));

    render(
      <Segmentation
        query={{ from: "2026-08-01", to: "2026-11-01" }}
        channels={["Social"]}
      />,
    );

    const stageSelect = await screen.findByRole("combobox", { name: "Visualizzazione fasi" });
    fireEvent.change(stageSelect, { target: { value: "active" } });

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain(
      "Non ci sono fasi disattivate nei risultati selezionati",
    );
  });

  it("nasconde il bucket delle fasi disattivate quando si selezionano solo le fasi attive", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/segments") return json(analysis(3, true));
      return json([]);
    }));

    render(
      <Segmentation
        query={{ from: "2026-08-01", to: "2026-11-01" }}
        channels={["Social"]}
      />,
    );

    expect(await screen.findByText("Fase disattivata")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Visualizzazione fasi" }), {
      target: { value: "active" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Fase disattivata")).toBeNull();
    });
  });
});
