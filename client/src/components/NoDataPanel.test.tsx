import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationContext } from "../navigation";
import { NoDataPanel } from "./NoDataPanel";

describe("NoDataPanel", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("chi può scrivere vede «Importa un file» (porta alla sezione di importazione) e «Carica dati di esempio»", () => {
    const navigate = vi.fn();
    render(<NavigationContext.Provider value={navigate}><NoDataPanel canWrite onImported={() => undefined} /></NavigationContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Importa un file" }));
    expect(navigate).toHaveBeenCalledWith("import");
    expect(screen.getByRole("button", { name: "Carica dati di esempio" })).toBeTruthy();
  });

  it("chi è in sola lettura non vede azioni di scrittura e riceve un'indicazione chiara", () => {
    render(<NoDataPanel canWrite={false} onImported={() => undefined} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/chiedi a un amministratore/i)).toBeTruthy();
  });

  it("carica i dati di esempio tramite l'API di importazione e aggiorna la dashboard", async () => {
    const onImported = vi.fn();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ importedCustomers: 240 }), { status: 201, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<NoDataPanel canWrite onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: "Carica dati di esempio" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/import");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.fileName).toBe("dati-di-esempio.csv");
    expect(body.rows.length).toBeGreaterThan(240);
  });

  it("se il caricamento fallisce mostra l'errore e non aggiorna la dashboard", async () => {
    const onImported = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "Un identificativo cliente è già presente nell'organizzazione." }), { status: 409, headers: { "Content-Type": "application/json" } }))));
    render(<NoDataPanel canWrite onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: "Carica dati di esempio" }));
    expect((await screen.findByRole("alert")).textContent).toContain("già presente");
    expect(onImported).not.toHaveBeenCalled();
  });
});
