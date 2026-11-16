import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAXMEM = 64 * 1024 * 1024;
const FORMAT = "scrypt";

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAXMEM },
      (error, derivedKey) => error ? reject(error) : resolve(derivedKey as Buffer),
    );
  });
}

/**
 * Password storage format: scrypt$N$r$p$base64url(salt)$base64url(key).
 * Passwords are never logged or persisted in plaintext. Session tokens use a
 * separate fast hash because they are uniformly random high-entropy secrets.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("La password deve contenere tra 12 e 1024 caratteri.");
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt);
  return [FORMAT, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Returns false for malformed hashes and wrong passwords without throwing. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== "string" || password.length > 1024 || typeof encoded !== "string" || encoded.length > 256) {
    return false;
  }
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT ||
      parts[1] !== String(SCRYPT_N) ||
      parts[2] !== String(SCRYPT_R) ||
      parts[3] !== String(SCRYPT_P)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;

  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}
