import { isIP } from "node:net";

// `require` encrypts the connection but does not reliably authenticate the
// server with node-postgres. Production remote databases must verify both CA
// trust and the server name.
const TLS_MODES = new Set(["verify-full"]);

/** Require an explicit encrypted connection for remote PostgreSQL in production. */
export function assertSecurePostgresTransport(
  connectionString: string,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (nodeEnvironment !== "production") return;

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL deve essere un URL PostgreSQL valido.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL deve usare il protocollo PostgreSQL.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localAddress = hostname === "localhost" || hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.split(".")[0] === "127");
  if (localAddress) return;

  const modes = url.searchParams.getAll("sslmode").map((mode) => mode.trim().toLowerCase());
  if (modes.length !== 1 || !TLS_MODES.has(modes[0] ?? "")) {
    throw new Error("DATABASE_URL per un database remoto in produzione deve specificare sslmode=verify-full.");
  }
}
