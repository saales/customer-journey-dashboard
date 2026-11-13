import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  cleanup();
  vi.unstubAllGlobals();
});

describe("Accesso PostgreSQL dal browser", () => {
  it("non consente l'accesso senza una sessione valida se il runtime non risponde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

    render(<AuthGate>{() => <p>Dashboard protetta</p>}</AuthGate>);

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
    fireEvent.change((await screen.findAllByLabelText("Email"))[0]!, { target: { value: "admin@example.it" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
    fireEvent.change(screen.getAllByLabelText("Codice organizzazione")[0]!, { target: { value: "azienda-demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Accedi" }));

    expect(await screen.findByRole("button", { name: "Esci test" })).toBeTruthy();
    const login = requests.find((request) => request.url === "/api/auth/login");
    expect(login?.init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      email: "admin@example.it", password: "correct horse battery staple", organizationSlug: "azienda-demo",
    });

    fireEvent.click(screen.getByRole("button", { name: "Esci test" }));
    await waitFor(() => expect(screen.getAllByLabelText("Email")[0]).toBeTruthy());
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
    render(<AuthGate>{(_logout, role) => <p>Ruolo: {role}</p>}</AuthGate>);
    fireEvent.change(await screen.findByLabelText("Nome e cognome"), { target: { value: "Nuovo utente" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password-Invito-2026" } });
    fireEvent.change(screen.getByLabelText("Conferma password"), { target: { value: "Password-Invito-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Accetta invito" }));
    expect(await screen.findByText("Ruolo: editor")).toBeTruthy();
    expect(requests).toContain("/api/invitations/accept");
    expect(requests).toContain("/api/auth/session");
    expect(window.location.search).toBe("");
  });


  it("richiede il recupero password senza rivelare se l'account esiste", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") return new Response(null, { status: 401 });
      if (url === "/api/auth/password-reset/request") {
        requests.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ accepted: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }));

    render(<AuthGate>{() => <p>Dashboard protetta</p>}</AuthGate>);
    fireEvent.click(await screen.findByText("Hai dimenticato la password?"));
    const emails = await screen.findAllByLabelText("Email");
    const organizations = screen.getAllByLabelText("Codice organizzazione");
    fireEvent.change(emails[1]!, { target: { value: "utente@example.it" } });
    fireEvent.change(organizations[1]!, { target: { value: "azienda-demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Invia istruzioni" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se l'account esiste e l'invio email è configurato, riceverai le istruzioni.",
    );
    expect(requests).toEqual([{
      url: "/api/auth/password-reset/request",
      body: { email: "utente@example.it", organizationSlug: "azienda-demo" },
    }]);
    expect(screen.queryByText("Dashboard protetta")).toBeNull();
  });

  it("completa il reset password con token e torna al login", async () => {
    window.history.replaceState({}, "", `/?reset=${"R".repeat(43)}`);
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/password-reset/complete") {
        requests.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ completed: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/auth/session") return new Response(null, { status: 401 });
      return new Response("not found", { status: 404 });
    }));

    render(<AuthGate>{() => <p>Dashboard protetta</p>}</AuthGate>);
    fireEvent.change(await screen.findByLabelText("Nuova password"), { target: { value: "Nuova-password-sicura-2026!" } });
    fireEvent.change(screen.getByLabelText("Conferma password"), { target: { value: "Nuova-password-sicura-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna password" }));

    expect(await screen.findByRole("button", { name: "Accedi" })).toBeTruthy();
    expect(requests).toEqual([{
      url: "/api/auth/password-reset/complete",
      body: { token: "R".repeat(43), password: "Nuova-password-sicura-2026!" },
    }]);
    expect(window.location.search).toBe("");
    expect(screen.queryByText("Dashboard protetta")).toBeNull();
  });

});
