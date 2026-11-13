import { createHmac } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool, PoolClient } from "pg";
import { authenticatePostgresCredentials } from "./postgres-authentication.js";
import { createPostgresPasswordReset, consumePostgresPasswordReset } from "./postgres-password-reset.js";
import { sendPostgresTransactionalEmail } from "./postgres-email.js";
import { revokePostgresSession } from "./postgres-session-repository.js";
import {
  getPostgresSessionCookieName,
  requirePostgresSession,
} from "./postgres-auth-middleware.js";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_IP_LOGIN_ATTEMPTS = 60;

export interface PostgresAuthRouterOptions {
  /** Elenco esplicito delle origini web ammesse, senza percorsi. */
  allowedOrigins: string[];
  /** Segreto casuale dedicato, almeno 32 caratteri, per pseudonimizzare le chiavi di limitazione. */
  rateLimitSecret: string;
  production?: boolean;
  emailApiKey?: string;
  emailFrom?: string;
}

function normalizeOrigins(origins: string[], production: boolean): Set<string> {
  const normalized = new Set<string>();
  for (const value of origins) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error("Origine web non valida nella configurazione."); }
    if (parsed.origin !== value || !["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Le origini web devono essere URL di origine esatti.");
    }
    if (parsed.protocol !== "https:" && production) {
      throw new Error("In produzione sono ammesse esclusivamente origini HTTPS.");
    }
    normalized.add(parsed.origin);
  }
  return normalized;
}

/** Controllo CSRF basato su Origin esatto; richieste senza Origin vengono rifiutate. */
export function isAllowedPostgresAuthOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

function getSessionToken(req: Request, cookieName: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const matches = header.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 1 || part.slice(0, index).trim() !== cookieName) return [];
    return [part.slice(index + 1).trim()];
  });
  return matches.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(matches[0]!) ? matches[0]! : null;
}

function appendCookie(res: Response, cookie: string): void {
  res.append("Set-Cookie", cookie);
}

export function serializePostgresSessionCookie(token: string, expiresAt: string, production: boolean): string {
  const name = getPostgresSessionCookieName(production);
  const expires = new Date(expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new Error("Scadenza sessione non valida.");
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${expires.toUTCString()}${production ? "; Secure" : ""}`;
}

export function clearPostgresSessionCookie(production: boolean): string {
  const name = getPostgresSessionCookieName(production);
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${production ? "; Secure" : ""}`;
}

function loginRateLimitKey(secret: string, scope: "ip" | "identity", address: string, email?: string): string {
  const hmac = createHmac("sha256", secret).update(scope).update("\0").update(address);
  if (scope === "identity") hmac.update("\0").update((email ?? "").trim().toLowerCase());
  return hmac.digest("hex");
}

async function consumeLoginBucket(client: PoolClient, keyHash: string, limit: number): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(
    `INSERT INTO login_attempt_limits (key_hash, window_started_at, attempts)
     VALUES ($1, NOW(), 1)
     ON CONFLICT (key_hash) DO UPDATE
     SET attempts = CASE
           WHEN login_attempt_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
           ELSE login_attempt_limits.attempts + 1
         END,
         window_started_at = CASE
           WHEN login_attempt_limits.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
           ELSE login_attempt_limits.window_started_at
         END,
         updated_at = NOW()
     RETURNING attempts <= $2 AS allowed`,
    [keyHash, limit],
  );
  return result.rows[0]?.allowed === true;
}

export async function consumePostgresLoginAttempt(
  pool: Pick<Pool, "connect">, secret: string, address: string, email: string,
): Promise<boolean> {
  const ipHash = loginRateLimitKey(secret, "ip", address);
  const identityHash = loginRateLimitKey(secret, "identity", address, email);
  const client: PoolClient = await pool.connect();
  let transaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query(`WITH stale AS (
      SELECT key_hash FROM login_attempt_limits
      WHERE updated_at < NOW() - INTERVAL '30 days'
      ORDER BY updated_at LIMIT 100
    )
    DELETE FROM login_attempt_limits AS limits USING stale
    WHERE limits.key_hash = stale.key_hash`);
    const ipAllowed = await consumeLoginBucket(client, ipHash, MAX_IP_LOGIN_ATTEMPTS);
    const identityAllowed = await consumeLoginBucket(client, identityHash, MAX_LOGIN_ATTEMPTS);
    await client.query("COMMIT");
    transaction = false;
    return ipAllowed && identityAllowed;
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    throw error;
  } finally {
    client.release(destroy);
  }
}
async function resetLoginAttempts(
  pool: Pick<Pool, "connect">,
  secret: string,
  address: string,
  email: string,
): Promise<void> {
  const keyHash = loginRateLimitKey(secret, "identity", address, email);
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM login_attempt_limits WHERE key_hash = $1", [keyHash]);
  } finally {
    client.release();
  }
}

/**
 * Router autonomo: montare sotto /api/auth dopo aver verificato schema e ruolo DB.
 * Richiede un elenco origini esplicito e un segreto di limitazione persistente.
 */
export function createPostgresAuthRouter(
  pool: Pick<Pool, "connect">,
  options: PostgresAuthRouterOptions,
) {
  if (!options || !Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) {
    throw new Error("Configurare almeno un'origine web autorizzata.");
  }
  if (typeof options.rateLimitSecret !== "string" || options.rateLimitSecret.length < 32) {
    throw new Error("LOGIN_RATE_LIMIT_SECRET deve contenere almeno 32 caratteri casuali.");
  }
  const production = options.production ?? process.env.NODE_ENV === "production";
  const origins = normalizeOrigins(options.allowedOrigins, production);
  const cookieName = getPostgresSessionCookieName(production);
  const router = Router();

  router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isAllowedPostgresAuthOrigin(req.get("Origin"), origins)) {
      res.status(403).json({ error: "Origine della richiesta non autorizzata." });
      return;
    }
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.email !== "string" || typeof body.password !== "string" ||
        typeof body.organizationSlug !== "string") {
      res.status(400).json({ error: "Inserire email, password e codice organizzazione." });
      return;
    }
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || body.password.length < 1 || body.password.length > 1024 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(body.organizationSlug)) {
      res.status(400).json({ error: "Credenziali o organizzazione non valide." });
      return;
    }

    try {
      // Non fidarsi di X-Forwarded-For: usare l'indirizzo del peer TCP.
      const address = req.ip || req.socket.remoteAddress || "unknown";
      if (!await consumePostgresLoginAttempt(pool, options.rateLimitSecret, address, email)) {
        res.setHeader("Retry-After", String(RATE_WINDOW_MS / 1000));
        res.status(429).json({ error: "Troppi tentativi. Riprovare più tardi." });
        return;
      }
      const issued = await authenticatePostgresCredentials(
        pool, email, body.password, body.organizationSlug,
      );
      if (!issued) {
        res.status(401).json({ error: "Credenziali non valide." });
        return;
      }
      await resetLoginAttempts(pool, options.rateLimitSecret, address, email);
      appendCookie(res, serializePostgresSessionCookie(issued.token, issued.expiresAt, production));
      res.status(200).json({ expiresAt: issued.expiresAt });
    } catch (error) {
      next(error);
    }
  });

  router.post("/password-reset/request", async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isAllowedPostgresAuthOrigin(req.get("Origin"), origins)) {
      res.status(403).json({ error: "Origine della richiesta non autorizzata." });
      return;
    }
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.email !== "string" || typeof body.organizationSlug !== "string" ||
        body.email.length > 254 || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(body.organizationSlug)) {
      res.status(400).json({ error: "Inserire un indirizzo email e un codice organizzazione validi." });
      return;
    }
    try {
      // Identical response for unknown accounts and disabled email delivery.
      if (options.emailApiKey && options.emailFrom) {
        const reset = await createPostgresPasswordReset(pool, body.email, body.organizationSlug);
        if (reset) {
          const link = new URL("/", req.get("Origin")!);
          link.searchParams.set("reset", reset.token);
          const safeName = reset.fullName.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
          try {
            await sendPostgresTransactionalEmail({
              to: reset.email,
              subject: "Reimposta la password — Percorso Cliente",
              text: `Ciao ${reset.fullName}, usa questo collegamento entro 30 minuti per reimpostare la password: ${link.toString()}. Se non hai richiesto tu il recupero, ignora questa email.`,
              html: `<p>Ciao ${safeName},</p><p>Hai richiesto di reimpostare la password di Percorso Cliente.</p><p><a href="${link.toString()}">Reimposta la password</a></p><p>Il collegamento scade tra 30 minuti. Se non hai richiesto tu il recupero, ignora questa email.</p>`,
            }, { apiKey: options.emailApiKey, from: options.emailFrom });
          } catch (emailError) {
            // Keep the same public response for known and unknown accounts.
            console.error("Invio email recupero password non riuscito:", emailError instanceof Error ? emailError.message : "errore sconosciuto");
          }
        }
      }
      res.status(202).json({ message: "Se l'account esiste e l'invio email è configurato, riceverai le istruzioni." });
    } catch (error) { next(error); }
  });

  router.post("/password-reset/complete", async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isAllowedPostgresAuthOrigin(req.get("Origin"), origins)) {
      res.status(403).json({ error: "Origine della richiesta non autorizzata." });
      return;
    }
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.token !== "string" || typeof body.password !== "string" ||
        body.password.length < 12 || body.password.length > 1024) {
      res.status(400).json({ error: "Inserire un collegamento valido e una password di almeno 12 caratteri." });
      return;
    }
    try {
      if (!await consumePostgresPasswordReset(pool, body.token, body.password)) {
        res.status(400).json({ error: "Il collegamento non è valido o è scaduto. Richiedi un nuovo recupero." });
        return;
      }
      appendCookie(res, clearPostgresSessionCookie(production));
      res.status(200).json({ message: "Password aggiornata. Accedi nuovamente." });
    } catch (error) { next(error); }
  });

  router.get("/session", requirePostgresSession(pool, cookieName), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = req.authenticatedSession!;
    res.json({ userId: session.userId, organizationId: session.organizationId, role: session.role });
  });

  router.post("/logout", requirePostgresSession(pool, cookieName), async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isAllowedPostgresAuthOrigin(req.get("Origin"), origins)) {
      res.status(403).json({ error: "Origine della richiesta non autorizzata." });
      return;
    }
    const token = getSessionToken(req, cookieName);
    if (!token) {
      res.status(401).json({ error: "Sessione non valida." });
      return;
    }
    try {
      await revokePostgresSession(pool, token);
      appendCookie(res, clearPostgresSessionCookie(production));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
