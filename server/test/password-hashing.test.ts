import { describe, expect, it } from "vitest";
import { hashPassword, passwordHashNeedsRehash, verifyPassword } from "../src/password-hashing.js";

const LEGACY_HASH = "scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$-LMJe_5NYS2FVj5wZhiiYAojo_D4THFEEWlZDG8wvPv-ub--CBRx_cNhUCm_jDnR8t2IiXFvVxQE2ufYOJSxmA";

describe("password hashing", () => {
  it("stores a salted scrypt hash and verifies only the matching password", async () => {
    const first = await hashPassword("Correct-Horse-Battery-42!");
    const second = await hashPassword("Correct-Horse-Battery-42!");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(passwordHashNeedsRehash(first)).toBe(false);
    await expect(verifyPassword("Correct-Horse-Battery-42!", first)).resolves.toBe(true);
    await expect(verifyPassword("another-password-123", first)).resolves.toBe(false);
  });

  it("verifies hashes precedenti e li marca per l'aggiornamento al prossimo accesso", async () => {
    expect(await verifyPassword("Correct-Horse-Battery-42!", LEGACY_HASH)).toBe(true);
    expect(await verifyPassword("incorrect-password", LEGACY_HASH)).toBe(false);
    expect(passwordHashNeedsRehash(LEGACY_HASH)).toBe(true);
  });

  it("rejects weak passwords and malformed hashes", async () => {
    await expect(hashPassword("short")).rejects.toThrow("12 e 1024");
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x".repeat(1025), LEGACY_HASH)).resolves.toBe(false);
    await expect(verifyPassword("password", "scrypt$999999$8$3$bad$bad")).resolves.toBe(false);
    await expect(verifyPassword("password", "scrypt$999999$8$1$bad$bad")).resolves.toBe(false);
  });
});
