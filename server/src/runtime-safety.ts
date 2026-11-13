/**
 * Prevents exposing the current prototype as a production SaaS.
 *
 * The active HTTP runtime still uses SQLite and has no authenticated,
 * organization-scoped request context. Until the PostgreSQL/authentication
 * runtime is implemented and verified, production startup must fail closed.
 */
export function assertRuntimeCanStart(nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === "production") {
    throw new Error(
      "Avvio in produzione bloccato: il backend usa ancora SQLite e non " +
      "dispone di autenticazione e isolamento multi-tenant. " +
      "Completare e verificare il runtime PostgreSQL prima del deploy.",
    );
  }
}


/**
 * Protects the explicit demo-data command from accidental or production use.
 */
export function assertDemoSeedAllowed(
  nodeEnv = process.env.NODE_ENV,
  allowDemoSeed = process.env.ALLOW_DEMO_SEED,
): void {
  if (nodeEnv === "production") {
    throw new Error(
      "Seed demo vietato in produzione: non inserire dati sintetici in un ambiente aziendale.",
    );
  }

  if (allowDemoSeed !== "true") {
    throw new Error(
      "Seed demo non autorizzato: impostare ALLOW_DEMO_SEED=true per confermare esplicitamente.",
    );
  }
}
