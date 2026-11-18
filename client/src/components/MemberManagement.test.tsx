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


describe("Invio degli inviti", () => {
  it("non dichiara che l'email è disconfigurata quando l'invio non è confermato", async () => {
    vi.mocked(api.createInvitation).mockResolvedValue({
      invitation: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "nuovo@example.it",
        role: "editor",
        status: "pending",
        createdAt: "2026-11-17T10:00:00Z",
        expiresAt: "2026-11-24T10:00:00Z",
        acceptedAt: null,
        revokedAt: null,
      },
      inviteUrl: "https://example.test/invite/token",
      emailSent: false,
    });

    render(<MemberManagement />);

    await screen.findByLabelText("Email");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nuovo@example.it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crea invito (7 giorni)" }));

    const message = await screen.findByText(
      /l’invio email non è stato confermato/,
    );
    const status = message.closest('[role="status"]');
    expect(status?.textContent).not.toContain("Email non configurata");
    expect((screen.getByLabelText("Collegamento da condividere") as HTMLInputElement).value).toBe(
      "https://example.test/invite/token",
    );
  });
});

describe("Revoca degli inviti", () => {
  it("richiede conferma prima di revocare un invito e mostra l'esito", async () => {
    const invitation = {
      id: "33333333-3333-4333-8333-333333333333",
      email: "ospite@example.it",
      role: "editor" as const,
      status: "pending" as const,
      createdAt: "2026-11-17T10:00:00Z",
      expiresAt: "2026-11-24T10:00:00Z",
      acceptedAt: null,
      revokedAt: null,
    };
    vi.mocked(api.invitations)
      .mockResolvedValueOnce([invitation])
      .mockResolvedValueOnce([]);
    vi.mocked(api.revokeInvitation).mockResolvedValue(undefined);

    render(<MemberManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoca" }));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(api.revokeInvitation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Revoca invito" }));
    await waitFor(() => {
      expect(api.revokeInvitation).toHaveBeenCalledWith(invitation.id);
    });
    expect((await screen.findByRole("status")).textContent).toContain("Invito revocato.");
  });
});

