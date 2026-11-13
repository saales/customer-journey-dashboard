import Database from "better-sqlite3";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { initSchema } from "../src/db.js";

let db: Database.Database;
let server: Server;
let base: string;

beforeAll(async () => {
  db = new Database(":memory:");
  initSchema(db);
  server = createApp(db).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  db.close();
});

describe("gestione errori JSON", () => {
  it("restituisce 400 per un body JSON malformato", async () => {
    const response = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"channel":',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "JSON non valido." });
  });

  it("restituisce 413 quando il body supera il limite configurato", async () => {
    const oversizedBody = JSON.stringify({
      payload: "x".repeat(12 * 1024 * 1024 + 1),
    });

    const response = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "Corpo della richiesta troppo grande.",
    });
  }, 20000);
});
