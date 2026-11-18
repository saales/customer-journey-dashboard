import { describe, expect, it } from "vitest";
import { assertSecurePostgresTransport } from "../src/postgres-transport-config.js";

describe("Configurazione sicura del trasporto PostgreSQL", () => {
  it("richiede la verifica del certificato e del nome host per i database remoti in produzione", () => {
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app", "production"))
      .toThrow(/sslmode=verify-full/);
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app?sslmode=disable", "production"))
      .toThrow(/sslmode=verify-full/);
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app?sslmode=require", "production"))
      .toThrow(/sslmode=verify-full/);
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app?sslmode=verify-ca", "production"))
      .toThrow(/sslmode=verify-full/);
  });

  it("accetta verify-full e i database locali", () => {
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app?sslmode=verify-full", "production"))
      .not.toThrow();
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@localhost/app?sslmode=disable", "production"))
      .not.toThrow();
  });

  it("rifiuta valori sslmode ambigui e ignora la regola fuori produzione", () => {
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app?sslmode=verify-full&sslmode=disable", "production"))
      .toThrow(/sslmode=verify-full/);
    expect(() => assertSecurePostgresTransport("postgresql://user:secret@db.example.it/app?sslmode=disable", "test"))
      .not.toThrow();
  });
});
