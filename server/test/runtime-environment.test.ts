import { describe, expect, it } from "vitest";
import { requireRuntimeEnvironment } from "../src/runtime-environment.js";

describe("requireRuntimeEnvironment", () => {
  it.each(["development", "test", "production"] as const)("accepts %s", (value) => {
    expect(requireRuntimeEnvironment(value)).toBe(value);
  });
  it.each([undefined, "", "prod", "staging", "Production"])( "rejects missing or unsupported values", (value) => {
    expect(() => requireRuntimeEnvironment(value)).toThrow(/NODE_ENV obbligatoria/);
  });
});
