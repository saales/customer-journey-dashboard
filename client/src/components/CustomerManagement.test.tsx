import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerManagement } from "./CustomerManagement";

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("CustomerManagement funnel integration", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders configured custom stages and submits their events in funnel order", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/funnel-stages")) {
        return json([
          { id: "visit", label: "Visita", position: 0, isActive: true, isSystem: true },
          { id: "custom_demo", label: "Demo completata", position: 1, isActive: true, isSystem: false },
          { id: "customer", label: "Cliente", position: 2, isActive: true, isSystem: true },
        ]);
      }
      if (String(url).startsWith("/api/customers") && init?.method === "POST") {
        return json({ id: "901", channel: "Organico", createdAt: "2026-06-01", events: [] }, 201);
      }
      if (String(url).startsWith("/api/customers")) {
        return json({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
      }
      return json({ error: "non trovato" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CustomerManagement onDataChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuovo cliente" }));

    expect(await screen.findByLabelText("Data: Demo completata")).toBeTruthy();
    expect(screen.getByLabelText("Data: Cliente")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Data della prima visita"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("Data: Demo completata"), {
      target: { value: "2026-06-03" },
    });
    fireEvent.change(screen.getByLabelText("Data: Cliente"), {
      target: { value: "2026-06-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva dati cliente" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) =>
        String(url) === "/api/customers" && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      const payload = JSON.parse(String(call?.[1]?.body));
      expect(payload.events).toEqual([
        { stage: "visit", occurredAt: "2026-06-01" },
        { stage: "custom_demo", occurredAt: "2026-06-03" },
        { stage: "customer", occurredAt: "2026-06-05" },
      ]);
    });
  });
});
