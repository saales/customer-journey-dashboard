import { afterEach, describe, expect, it } from "vitest";
import { createPostgresApp, isValidPostgresDate } from "../src/postgres-app.js";

const servers: Array<{ close: (callback: (error?: Error) => void) => void }> = [];
const pool = {
  connect: async () => { throw new Error("La connessione DB non deve essere usata in questo test."); },
  query: async () => ({ rows: [{ ready: 1 }], rowCount: 1 }),
};

async function startApp() {
  const app = createPostgresApp(pool as never, {
    allowedOrigins: ["https://app.example.it"],
    rateLimitSecret: "test-secret-that-is-long-enough-123456",
    production: false,
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta test non disponibile.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  ));
});

describe("Validazione date PostgreSQL", () => {
  it("accetta solo date ISO reali nel formato YYYY-MM-DD", () => {
    expect(isValidPostgresDate("2026-11-13")).toBe(true);
    expect(isValidPostgresDate("2024-02-29")).toBe(true);
    expect(isValidPostgresDate("2025-02-29")).toBe(false);
    expect(isValidPostgresDate("2026-13-01")).toBe(false);
    expect(isValidPostgresDate("13-11-2026")).toBe(false);
  });
});

describe("Runtime HTTP PostgreSQL", () => {
  it("espone readiness PostgreSQL e header di sicurezza", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "connected" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("nega le API protette senza sessione valida", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/customers`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Accesso richiesto." });
  });

  it("nega la consultazione del registro attività senza sessione valida", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/audit`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Accesso richiesto." });
  });

  it("applica il controllo Origin prima di ogni scrittura API", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ externalId: "1" }),
    });
    expect(response.status).toBe(403);
  });

  it("non accetta origini mancanti per le scritture", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/funnel-stages/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages: [] }),
    });
    expect(response.status).toBe(403);
  });

  it("rifiuta JSON malformato con una risposta 400", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"broken":',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Il corpo JSON non è valido." });
  });

  it("limita a 1 MiB le richieste JSON ordinarie", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(1024 * 1024 + 10) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "La richiesta supera il limite consentito." });
  });

  it("consente il limite dedicato alle importazioni prima del controllo CSRF", async () => {
    const base = await startApp();
    const response = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "large.csv", rows: [], note: "x".repeat(1024 * 1024 + 10) }),
    });
    // Il body viene analizzato entro il limite import; la richiesta è poi respinta
    // perché manca l'Origin ammesso, prima di raggiungere l'endpoint autenticato.
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origine della richiesta non autorizzata." });
  });

  it("espone le route inviti, le protegge con sessione e valida il token pubblico", async () => {
    const base = await startApp();
    const list = await fetch(`${base}/api/invitations`);
    expect(list.status).toBe(401);
    const create = await fetch(`${base}/api/invitations`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.example.it" },
      body: JSON.stringify({ email: "collaboratore@example.it", role: "editor", expiresInDays: 7 }),
    });
    expect(create.status).toBe(401);
    const accept = await fetch(`${base}/api/invitations/accept`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.example.it" },
      body: JSON.stringify({ token: "non-valido", fullName: "Collaboratore", password: "Password-sicura-2026" }),
    });
    expect(accept.status).toBe(400);
    expect(await accept.json()).toEqual({ error: "Codice invito non valido." });
  });

  it("rifiuta configurazioni HTTP in produzione", () => {
    expect(() => createPostgresApp(pool as never, {
      allowedOrigins: ["http://app.example.it"],
      rateLimitSecret: "test-secret-that-is-long-enough-123456",
      production: true,
    })).toThrow("In produzione sono ammesse esclusivamente origini HTTPS.");
  });
});
