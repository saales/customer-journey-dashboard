import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLog } from "./AuditLog";

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  }));
}

describe("AuditLog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra lo storico e applica i filtri utente, operazione e date", async () => {
    const auditPage = {
      data: [{
        id: "1", action: "customer.created", resourceType: "customer", resourceId: "42",
        actorUserId: "11111111-1111-4111-8111-111111111111",
        actorName: "Admin Uno", actorEmail: "admin@example.test",
        details: { channel: "Organico" }, createdAt: "2026-11-12T10:30:00.000Z",
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    };
    const members = [{
      membershipId: "m1", userId: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.test", fullName: "Admin Uno", role: "admin", status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
    }];
    const fetchMock = vi.fn((url: string) => {
      if (String(url).startsWith("/api/audit")) return json(auditPage);
      if (String(url).startsWith("/api/members")) return json(members);
      return json({ error: "non trovato" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuditLog />);
    expect(await screen.findByText("Cliente creato")).toBeTruthy();
    expect(screen.getByText("Admin Uno")).toBeTruthy();
    expect(screen.getByText("customer 42")).toBeTruthy();
    expect(screen.getByText("channel: Organico")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Dal"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Al"), { target: { value: "2026-11-13" } });
    fireEvent.change(screen.getByLabelText("Utente"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Operazione"), { target: { value: "customer.created" } });
    fireEvent.click(screen.getByRole("button", { name: "Applica filtri" }));

    await waitFor(() => {
      const auditCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("/api/audit?") &&
        String(url).includes("from=2026-11-01") &&
        String(url).includes("to=2026-11-13") &&
        String(url).includes("actorUserId=11111111") &&
        String(url).includes("action=customer.created"),
      );
      expect(auditCall).toBeTruthy();
    });
  });
});
