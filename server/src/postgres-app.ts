import express, { type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { CHANNELS } from "./types.js";
import {
  requirePostgresSession,
  requireOrganizationPermission,
} from "./postgres-auth-middleware.js";
import { createPostgresAuthRouter, isAllowedPostgresAuthOrigin } from "./postgres-auth-routes.js";
import {
  createPostgresCustomer,
  listPostgresCustomers,
} from "./postgres-customer-repository.js";
import {
  listPostgresFunnelStages,
  reorderPostgresFunnelStages,
  updatePostgresFunnelStage,
} from "./postgres-funnel-repository.js";

export interface PostgresAppOptions {
  allowedOrigins: string[];
  rateLimitSecret: string;
  production?: boolean;
}

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function parseAllowedOrigins(values: string[], production: boolean): Set<string> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Configurare almeno un'origine web autorizzata.");
  }
  const result = new Set<string>();
  for (const value of values) {
    let origin: URL;
    try { origin = new URL(value); } catch { throw new Error("Origine web non valida nella configurazione."); }
    if (origin.origin !== value || !["https:", "http:"].includes(origin.protocol)) {
      throw new Error("Le origini web devono essere URL di origine esatti.");
    }
    if (production && origin.protocol !== "https:") {
      throw new Error("In produzione sono ammesse esclusivamente origini HTTPS.");
    }
    result.add(origin.origin);
  }
  return result;
}

function parsePage(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ApiError(400, "Parametro di paginazione non valido.");
  }
  return parsed;
}

function validateCustomerBody(body: unknown): {
  externalId: string; channel: string; createdAt: string;
  events: { stage: string; occurredAt: string }[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Il corpo della richiesta non è valido.");
  }
  const data = body as Record<string, unknown>;
  if (typeof data.externalId !== "string" || !data.externalId.trim() ||
      data.externalId.length > 100 || typeof data.channel !== "string" ||
      !data.channel.trim() || !(CHANNELS as readonly string[]).includes(data.channel) ||
      typeof data.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.createdAt) ||
      Number.isNaN(Date.parse(data.createdAt)) ||
      new Date(data.createdAt).toISOString().slice(0, 10) !== data.createdAt) {
    throw new ApiError(400, "Dati cliente non validi.");
  }
  if (!Array.isArray(data.events) || data.events.length === 0 || data.events.length > 50) {
    throw new ApiError(400, "Il percorso deve contenere da 1 a 50 eventi.");
  }
  const events = data.events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new ApiError(400, "Evento non valido.");
    }
    const item = event as Record<string, unknown>;
    if (typeof item.stage !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.stage) ||
        typeof item.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt) ||
        Number.isNaN(Date.parse(item.occurredAt)) ||
        new Date(item.occurredAt).toISOString().slice(0, 10) !== item.occurredAt) {
      throw new ApiError(400, "Evento non valido.");
    }
    return { stage: item.stage, occurredAt: item.occurredAt };
  });
  return {
    externalId: data.externalId.trim(),
    channel: data.channel.trim(),
    createdAt: data.createdAt,
    events,
  };
}

/**
 * PostgreSQL-only HTTP application. Tenant identity is always taken from the
 * verified session; no endpoint accepts an organization identifier from input.
 */
export function createPostgresApp(pool: Pick<Pool, "connect" | "query">, options: PostgresAppOptions) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const origins = parseAllowedOrigins(options.allowedOrigins, production);
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  // CSRF guard for every state-changing API route, including future routes.
  app.use("/api", (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    if (!isAllowedPostgresAuthOrigin(req.get("Origin"), origins)) {
      res.status(403).json({ error: "Origine della richiesta non autorizzata." });
      return;
    }
    next();
  });

  app.get("/api/health", async (_req, res, next) => {
    try {
      await pool.query("SELECT 1 AS ready");
      res.json({ status: "ok", database: "connected" });
    } catch (error) { next(error); }
  });

  app.use("/api/auth", createPostgresAuthRouter(pool, {
    allowedOrigins: [...origins],
    rateLimitSecret: options.rateLimitSecret,
    production,
  }));

  const authenticated = requirePostgresSession(
    pool,
    production ? "__Host-percorso_session" : "percorso_session",
  );

  app.get("/api/customers", authenticated,
    requireOrganizationPermission("customers:read"),
    async (req, res, next) => {
      try {
        const page = parsePage(req.query.page, 1, 1_000_000);
        const limit = parsePage(req.query.limit, 50, 100);
        const session = req.authenticatedSession!;
        res.json(await listPostgresCustomers(pool, session.organizationId, page, limit));
      } catch (error) { next(error); }
    });

  app.post("/api/customers", authenticated,
    requireOrganizationPermission("customers:write"),
    async (req, res, next) => {
      try {
        const input = validateCustomerBody(req.body);
        const session = req.authenticatedSession!;
        const created = await createPostgresCustomer(pool, session.organizationId, input);
        res.status(201).json(created);
      } catch (error) { next(error); }
    });

  app.get("/api/funnel-stages", authenticated,
    requireOrganizationPermission("funnel:read"),
    async (req, res, next) => {
      try {
        res.json(await listPostgresFunnelStages(pool, req.authenticatedSession!.organizationId));
      } catch (error) { next(error); }
    });

  app.put("/api/funnel-stages/reorder", authenticated,
    requireOrganizationPermission("funnel:write"),
    async (req, res, next) => {
      try {
        const stages = (req.body as { stages?: unknown } | undefined)?.stages;
        if (!Array.isArray(stages) || stages.length > 100 ||
            stages.some((id) => typeof id !== "string")) {
          throw new ApiError(400, "Elenco delle fasi non valido.");
        }
        const result = await reorderPostgresFunnelStages(
          pool, req.authenticatedSession!.organizationId, stages as string[],
        );
        res.json(result);
      } catch (error) { next(error); }
    });

  app.put("/api/funnel-stages/:id", authenticated,
    requireOrganizationPermission("funnel:write"),
    async (req, res, next) => {
      try {
        const body = req.body as Record<string, unknown> | undefined;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new ApiError(400, "Modifiche fase non valide.");
        }
        const updates: { label?: unknown; isActive?: unknown } = {};
        if (Object.prototype.hasOwnProperty.call(body, "label")) updates.label = body.label;
        if (Object.prototype.hasOwnProperty.call(body, "isActive")) updates.isActive = body.isActive;
        const result = await updatePostgresFunnelStage(
          pool, req.authenticatedSession!.organizationId, req.params.id, updates,
        );
        res.json(result);
      } catch (error) { next(error); }
    });

  app.use((_req, res) => res.status(404).json({ error: "Risorsa non trovata." }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    // Do not disclose SQL, credentials, connection strings or internal details.
    console.error("Errore API PostgreSQL:", error instanceof Error ? error.message : "errore sconosciuto");
    res.status(500).json({ error: "Errore interno del server." });
  });

  return app;
}
