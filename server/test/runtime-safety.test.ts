import { describe, expect, it } from "vitest";
import { assertRuntimeCanStart } from "../src/runtime-safety.js";

describe("assertRuntimeCanStart", () => {
  it.each(["development", "test", ""])(
    "consente l'avvio nell'ambiente %s",
    (nodeEnv) => {
      expect(() => assertRuntimeCanStart(nodeEnv)).not.toThrow();
    },
  );

  it("blocca l'avvio in produzione finché il runtime SaaS non è pronto", () => {
    expect(() => assertRuntimeCanStart("production")).toThrow(
      /backend usa ancora SQLite.*autenticazione e isolamento multi-tenant/,
    );
  });
});


describe("assertDemoSeedAllowed", () => {
  it("richiede un consenso esplicito", async () => {
    const { assertDemoSeedAllowed } = await import("../src/runtime-safety.js");
    expect(() => assertDemoSeedAllowed("development", undefined)).toThrow(
      /ALLOW_DEMO_SEED=true/,
    );
  });

  it("consente il seed solo con consenso esplicito in ambienti non production", async () => {
    const { assertDemoSeedAllowed } = await import("../src/runtime-safety.js");
    expect(() => assertDemoSeedAllowed("development", "true")).not.toThrow();
    expect(() => assertDemoSeedAllowed("test", "true")).not.toThrow();
  });

  it("vieta il seed in produzione anche con consenso esplicito", async () => {
    const { assertDemoSeedAllowed } = await import("../src/runtime-safety.js");
    expect(() => assertDemoSeedAllowed("production", "true")).toThrow(
      /vietato in produzione/,
    );
  });
});
