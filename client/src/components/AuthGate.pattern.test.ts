import { describe, expect, it } from "vitest";
import { ORGANIZATION_SLUG_PATTERN } from "./AuthGate";

// Regressione: il pattern precedente produceva "is not a valid regular expression" nei browser (modalità `v`)
// e la validazione del campo veniva ignorata.
describe("ORGANIZATION_SLUG_PATTERN", () => {
  const re = new RegExp(`^(?:${ORGANIZATION_SLUG_PATTERN})$`, "v"); // deve compilare in modalità v, come nei browser
  it.each(["demo", "azienda-demo", "a1", "a", "staging-a-2026"])("accetta %s", (slug) => expect(re.test(slug)).toBe(true));
  it.each(["Demo", "-demo", "demo-", "demo corp", "de_mo", "démo", "a".repeat(101)])("rifiuta %s", (slug) => expect(re.test(slug)).toBe(false));
});
