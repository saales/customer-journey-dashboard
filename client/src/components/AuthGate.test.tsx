import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  cleanup();
  vi.unstubAllGlobals();
});

describe("Accesso PostgreSQL dal browser", () => {
  it("non entra automaticamente in modalità dimostrativa se il runtime non risponde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

    render(<AuthGate>{() => <p>Dashboard dimostrativa</p>}</AuthGate>);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Servizio di accesso non disponibile. Verificare il runtime PostgreSQL.")).toBeTruthy();
    expect(screen.queryByText("Dashboard dimostrativa")).toBeNull();
  });


  it("accede con cookie HttpOnly, verifica la sessione ed esegue la revoca all'uscita", async () => {
    let sessionChecks = 0;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "/api/auth/session") {
        sessionChecks += 1;
        if (sessionChecks === 1) return new Response(JSON.stringify({ error: "Accesso richiesto." }), { status: 401 });
        return new Response(JSON.stringify({ userId: "user-1", organizationId: "org-1", role: "admin" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/auth/login") {
        return new Response(JSON.stringify({ expiresAt: "2026-12-01T00:00:00.000Z" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/auth/logout") return new Response(null, { status: 204 });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate>{(logout) => <button onClick={() => void logout()}>Esci test</button>}</AuthGate>);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "admin@example.it" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
    fireEvent.change(screen.getByLabelText("Codice organizzazione"), { target: { value: "azienda-demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    expect(await screen.findByRole("button", { name: "Esci test" })).toBeTruthy();
    const login = requests.find((request) => request.url === "/api/auth/login");
    expect(login?.init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      email: "admin@example.it", password: "correct horse battery staple", organizationSlug: "azienda-demo",
    });

    fireEvent.click(screen.getByRole("button", { name: "Esci test" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
    expect(requests.some((request) => request.url === "/api/auth/logout")).toBe(true);
  });

  it("accetta un invito monouso e verifica la sessione appena creata", async () => {
    window.history.replaceState({}, "", `/?token=${"A".repeat(43)}`);
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requests.push(url);
      if (url === "/api/invitations/accept") return new Response(JSON.stringify({ organizationSlug: "azienda-demo" }), { status: 201, headers: { "Content-Type": "application/json" } });
      if (url === "/api/auth/session") return new Response(JSON.stringify({ userId: "user-1", organizationId: "org-1", role: "editor" }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthGate>{(_logout, _demo, role) => <p>Ruolo: {role}</p>}</AuthGate>);
    fireEvent.change(await screen.findByLabelText("Nome e cognome"), { target: { value: "Nuovo utente" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password-Invito-2026" } });
    fireEvent.change(screen.getByLabelText("Conferma password"), { target: { value: "Password-Invito-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Accetta invito" }));
    expect(await screen.findByText("Ruolo: editor")).toBeTruthy();
    expect(requests).toContain("/api/invitations/accept");
    expect(requests).toContain("/api/auth/session");
    expect(window.location.search).toBe("");
  });

});
