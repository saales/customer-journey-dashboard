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
