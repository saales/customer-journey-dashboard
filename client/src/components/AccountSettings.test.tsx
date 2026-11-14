import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AccountSettings } from "./AccountSettings";

vi.mock("../api", () => ({
  api: {
    account: vi.fn(),
    updateAccount: vi.fn(),
    changePassword: vi.fn(),
  },
}));

const profile = {
  userId: "user-1",
  email: "utente@example.it",
  fullName: "Utente Demo",
  role: "editor" as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(api.accountSessions).mockResolvedValue({ sessions: [{ id: "session-current", createdAt: "2026-11-14T10:00:00Z", lastUsedAt: "2026-11-14T11:00:00Z", expiresAt: "2026-11-14T22:00:00Z", current: true }] });
});

describe("Impostazioni account", () => {
  it("carica il profilo e salva il nome aggiornato", async () => {
    vi.mocked(api.account).mockResolvedValue(profile);
    vi.mocked(api.updateAccount).mockResolvedValue({ ...profile, fullName: "Utente Aggiornato" });
    render(<AccountSettings />);

    const name = await screen.findByLabelText("Nome e cognome");
    expect((name as HTMLInputElement).value).toBe("Utente Demo");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("utente@example.it");
    expect((screen.getByLabelText("Ruolo") as HTMLInputElement).value).toBe("editor");

    fireEvent.change(name, { target: { value: "Utente Aggiornato" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva profilo" }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith("Utente Aggiornato"));
    expect((await screen.findByRole("status")).textContent).toContain("Profilo aggiornato.");
    expect((name as HTMLInputElement).value).toBe("Utente Aggiornato");
  });

  it("non invia il cambio password se le conferme non coincidono", async () => {
    vi.mocked(api.account).mockResolvedValue(profile);
    render(<AccountSettings />);
    await screen.findByLabelText("Password attuale");

    fireEvent.change(screen.getByLabelText("Password attuale"), { target: { value: "Password-attuale-2026!" } });
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: "Nuova-password-sicura-2026!" } });
    fireEvent.change(screen.getByLabelText("Conferma nuova password"), { target: { value: "Password-diversa-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambia password" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Le nuove password non coincidono.");
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("mostra le sessioni e revoca una sessione non corrente", async () => {
    vi.mocked(api.account).mockResolvedValue(profile);
    vi.mocked(api.accountSessions).mockResolvedValue({ sessions: [
      { id: "session-current", createdAt: "2026-11-14T10:00:00Z", lastUsedAt: "2026-11-14T11:00:00Z", expiresAt: "2026-11-14T22:00:00Z", current: true },
      { id: "session-other", createdAt: "2026-11-13T10:00:00Z", lastUsedAt: "2026-11-13T11:00:00Z", expiresAt: "2026-11-13T22:00:00Z", current: false },
    ] });
    vi.mocked(api.revokeAccountSession).mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AccountSettings />);
    expect(await screen.findByText("Questo dispositivo")).toBeTruthy();
    expect(screen.getByText("Sessione attiva")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoca" }));
    await waitFor(() => expect(api.revokeAccountSession).toHaveBeenCalledWith("session-other"));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Sessione revocata.");
    confirm.mockRestore();
  });

  it("mostra un errore se il profilo non può essere caricato", async () => {
    vi.mocked(api.account).mockRejectedValue(new Error("Servizio non disponibile"));
    render(<AccountSettings />);
    expect((await screen.findByRole("alert")).textContent).toContain("Servizio non disponibile");
  });
});
