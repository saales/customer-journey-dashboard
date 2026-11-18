import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPostgresTransactionalEmail } from "../src/postgres-email.js";

describe("provider email transazionale", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resta disabilitato senza credenziali e non effettua chiamate di rete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendPostgresTransactionalEmail({
      to: "person@example.test", subject: "Test", text: "Test", html: "<p>Test</p>",
    }, {})).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invia il messaggio al provider configurato", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendPostgresTransactionalEmail({
      to: "person@example.test", subject: "Invito", text: "Apri il link", html: "<p>Apri il link</p>",
    }, { apiKey: "test-key", from: "Percorso Cliente <noreply@example.test>" })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it("non nasconde errori restituiti dal provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(sendPostgresTransactionalEmail({
      to: "person@example.test", subject: "Test", text: "Test", html: "<p>Test</p>",
    }, { apiKey: "test-key", from: "noreply@example.test" })).rejects.toThrow("HTTP 503");
  });
});
