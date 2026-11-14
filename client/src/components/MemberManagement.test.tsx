import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { MemberManagement } from "./MemberManagement";

vi.mock("../api", () => ({
  api: {
    members: vi.fn(),
    invitations: vi.fn(),
    updateMember: vi.fn(),
    createInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}));

const member = {
  membershipId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  email: "utente@example.it",
  fullName: "Utente Esempio",
  role: "editor" as const,
  status: "active" as const,
  joinedAt: "2026-01-15T10:00:00Z",
};

beforeEach(() => {
  vi.mocked(api.members).mockResolvedValue([member]);
  vi.mocked(api.invitations).mockResolvedValue([]);
  vi.mocked(api.updateMember).mockResolvedValue({ ...member, role: "analyst" });
  vi.mocked(api.createInvitation).mockReset();
  vi.mocked(api.revokeInvitation).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Gestione membri", () => {
  it("mostra l'esito dell'operazione anche se il successivo aggiornamento dell'elenco fallisce", async () => {
    vi.mocked(api.members)
      .mockResolvedValueOnce([member])
      .mockRejectedValueOnce(new Error("Connessione interrotta"));

    render(<MemberManagement />);

    const roleSelect = await screen.findByRole("combobox", { name: "Ruolo di utente@example.it" });
    fireEvent.change(roleSelect, { target: { value: "analyst" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva ruolo" }));

    await waitFor(() => {
      expect(api.updateMember).toHaveBeenCalledWith(member.membershipId, { role: "analyst" });
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "Modifica salvata, ma non è stato possibile aggiornare l'elenco.",
    );
    expect(screen.getByRole("alert").textContent).toContain("Connessione interrotta");
  });
});
