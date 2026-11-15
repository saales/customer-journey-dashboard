import { describe, expect, it } from "vitest";
import { hashPassword, needsPasswordRehash, verifyPassword } from "../src/password-hashing.js";

describe("password hashing", () => {
  it("stores a salted scrypt hash and verifies only the matching password", async () => {
    const first = await hashPassword("Correct-Horse-Battery-42!");
    const second = await hashPassword("Correct-Horse-Battery-42!");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt\$32768\$8\$3\$/);
    await expect(verifyPassword("Correct-Horse-Battery-42!", first)).resolves.toBe(true);
    await expect(verifyPassword("another-password-123", first)).resolves.toBe(false);
  });

  it("verifies legacy p=1 hashes and marks them for upgrade", async () => {
    const legacy = "scrypt$32768$8$1$nypNbIseP1BxkqS2yNDi9A$V1Uink-dXO4qu89e0yyMjBoIcPnovdIKB2ALYqiOAVbJMCtmuMfu-4psz231onKp-Xeqa9s3j5G-thsnDfLC5w";
    await expect(verifyPassword("Correct-Horse-Battery-42!", legacy)).resolves.toBe(true);
    expect(needsPasswordRehash(legacy)).toBe(true);
    const current = await hashPassword("Correct-Horse-Battery-42!");
    expect(needsPasswordRehash(current)).toBe(false);
  });

  it("rejects weak passwords and malformed hashes", async () => {
    await expect(hashPassword("short")).rejects.toThrow("12 e 1024");
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x".repeat(1025), "scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86))).resolves.toBe(false);
    await expect(verifyPassword("password", "scrypt$999999$8$1$bad$bad")).resolves.toBe(false);
  });
});
