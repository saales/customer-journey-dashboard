import { describe, expect, it } from "vitest";
import { readIntegerEnvironment } from "../src/runtime-config.js";

describe("readIntegerEnvironment", () => {
  it("usa il valore predefinito se la variabile manca o è vuota", () => {
    expect(readIntegerEnvironment({}, "X", 5, 1, 50)).toBe(5);
    expect(readIntegerEnvironment({ X: "  " }, "X", 5, 1, 50)).toBe(5);
  });
  it("accetta interi nell'intervallo, estremi inclusi", () => {
    expect(readIntegerEnvironment({ X: "20" }, "X", 5, 1, 50)).toBe(20);
    expect(readIntegerEnvironment({ X: "1" }, "X", 5, 1, 50)).toBe(1);
    expect(readIntegerEnvironment({ X: "50" }, "X", 5, 1, 50)).toBe(50);
  });
  it.each(["0", "51", "-3", "2.5", "abc", "1e2", "0x10"])("rifiuta %s con errore di configurazione", (value) => {
    expect(() => readIntegerEnvironment({ X: value }, "X", 5, 1, 50)).toThrow(/X deve essere un intero tra 1 e 50/);
  });
});
