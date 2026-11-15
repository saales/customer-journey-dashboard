export type RuntimeEnvironment = "development" | "test" | "production";

/** Require an explicit runtime mode so production security never depends on an unset variable. */
export function requireRuntimeEnvironment(value: string | undefined): RuntimeEnvironment {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error('NODE_ENV obbligatoria: usare esclusivamente "development", "test" oppure "production".');
}
