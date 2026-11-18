import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const CURRENT_SCRYPT = { N: 32_768, r: 8, p: 3 } as const;
const SUPPORTED_SCRYPT = [CURRENT_SCRYPT, { N: 32_768, r: 8, p: 1 }] as const;
const MAXMEM = 64 * 1024 * 1024;
const FORMAT = "scrypt";

interface ParsedPasswordHash {
  parameters: (typeof SUPPORTED_SCRYPT)[number];
  salt: Buffer;
  key: Buffer;
}

function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  if (typeof encoded !== "string" || encoded.length > 256) return null;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT) return null;
  const parameters = SUPPORTED_SCRYPT.find((candidate) =>
    parts[1] === String(candidate.N) && parts[2] === String(candidate.r) && parts[3] === String(candidate.p));
  if (!parameters) return null;

  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    key = Buffer.from(parts[5]!, "base64url");
  } catch {
    return null;
  }
  if (salt.length !== SALT_LENGTH || key.length !== KEY_LENGTH) return null;
  return { parameters, salt, key };
}

export function passwordHashNeedsRehash(encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  return Boolean(parsed && (
    parsed.parameters.N !== CURRENT_SCRYPT.N ||
    parsed.parameters.r !== CURRENT_SCRYPT.r ||
    parsed.parameters.p !== CURRENT_SCRYPT.p
  ));
}

function deriveKey(password: string, salt: Buffer, parameters: ParsedPasswordHash["parameters"]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { ...parameters, maxmem: MAXMEM },
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
  const key = await deriveKey(password, salt, CURRENT_SCRYPT);
  return [FORMAT, CURRENT_SCRYPT.N, CURRENT_SCRYPT.r, CURRENT_SCRYPT.p,
    salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Returns false for malformed hashes and wrong passwords without throwing. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== "string" || password.length > 1024) return false;
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const actual = await deriveKey(password, parsed.salt, parsed.parameters);
  return timingSafeEqual(actual, parsed.key);
}
