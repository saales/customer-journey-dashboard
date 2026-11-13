import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("usa il punto e virgola, il BOM e la fine riga CRLF", () => {
    const csv = toCsv(["Canale", "Visite"], [["Email", 400]]);
    expect(csv).toBe("\uFEFFCanale;Visite\r\nEmail;400\r\n");
  });

  it("scrive i decimali con la virgola", () => {
    expect(toCsv(["Conversione"], [[3.3]])).toContain("3,3");
  });

  it("racchiude tra virgolette i testi con separatori, virgolette o a capo", () => {
    const csv = toCsv(["Nota"], [["a;b"], ['dice "ciao"'], ["riga1\nriga2"]]);
    expect(csv).toContain('"a;b"');
    expect(csv).toContain('"dice ""ciao"""');
    expect(csv).toContain('"riga1\nriga2"');
  });

  it("lascia vuote le celle nulle", () => {
    expect(toCsv(["A", "B"], [[null, 1]])).toContain("\r\n;1\r\n");
  });
});
