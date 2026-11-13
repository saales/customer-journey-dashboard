import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { OrganizationSettings } from "./OrganizationSettings";

vi.mock("../api", () => ({
  api: {
    organization: vi.fn(),
    updateOrganization: vi.fn(),
  },
}));

const initialSettings = {
  id: "org-1",
  name: "Azienda Demo",
  slug: "azienda-demo",
  createdAt: "2026-01-15T10:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Impostazioni organizzazione", () => {
  it("carica i dati e salva il nuovo nome", async () => {
    vi.mocked(api.organization).mockResolvedValue(initialSettings);
    vi.mocked(api.updateOrganization).mockResolvedValue({
      ...initialSettings,
      name: "Azienda Demo S.p.A.",
    });

    render(<OrganizationSettings />);

    const name = await screen.findByLabelText("Nome organizzazione");
    expect(name).toHaveValue("Azienda Demo");
    expect(screen.getByLabelText("Codice organizzazione")).toHaveValue("azienda-demo");
    expect(screen.getByLabelText("Creata il")).toBeTruthy();

    fireEvent.change(name, { target: { value: "Azienda Demo S.p.A." } });
    fireEvent.click(screen.getByRole("button", { name: "Salva modifiche" }));

    await waitFor(() => expect(api.updateOrganization).toHaveBeenCalledWith("Azienda Demo S.p.A."));
    expect(await screen.findByRole("status")).toHaveTextContent("Nome organizzazione aggiornato.");
    expect(name).toHaveValue("Azienda Demo S.p.A.");
  });

  it("mostra un errore leggibile se il caricamento fallisce", async () => {
    vi.mocked(api.organization).mockRejectedValue(new Error("Servizio non disponibile"));
    render(<OrganizationSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Servizio non disponibile");
  });

  it("non invia modifiche quando il nome non è cambiato", async () => {
    vi.mocked(api.organization).mockResolvedValue(initialSettings);
    render(<OrganizationSettings />);
    await screen.findByLabelText("Nome organizzazione");
    expect(screen.getByRole("button", { name: "Salva modifiche" })).toBeDisabled();
    expect(api.updateOrganization).not.toHaveBeenCalled();
  });
});
