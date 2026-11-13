import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CHANNELS } from "./types.js";
import { exportPostgresCustomersCsv, PostgresExportError } from "./postgres-export-repository.js";
import { listOrganizationMembers, updateOrganizationMember, MemberManagementError } from "./postgres-members-repository.js";
import { getPostgresChannels, getPostgresMeta, getPostgresSummary, getPostgresTimeseries } from "./postgres-analytics-repository.js";
import { getPostgresSegmentCustomers, getPostgresSegments, type SegmentDimension } from "./postgres-segmentation-repository.js";
import { importPostgresCustomers, PostgresImportError, type PostgresImportRow } from "./postgres-import-repository.js";
import {
  requirePostgresSession,
  requireOrganizationPermission,
} from "./postgres-auth-middleware.js";
import { createPostgresAuthRouter, isAllowedPostgresAuthOrigin } from "./postgres-auth-routes.js";
import {
  createPostgresCustomer,
  updatePostgresCustomer,
  deletePostgresCustomer,
  listPostgresCustomers,
} from "./postgres-customer-repository.js";
import {
  createPostgresFunnelStage,
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

export function isValidPostgresDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
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
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Il corpo della richiesta non è valido.");
  const data = body as Record<string, unknown>;
  if ((data.externalId !== undefined && (typeof data.externalId !== "string" || !data.externalId.trim() || data.externalId.length > 100)) ||
      typeof data.channel !== "string" || !(CHANNELS as readonly string[]).includes(data.channel) ||
      typeof data.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.createdAt) ||
      Number.isNaN(Date.parse(data.createdAt)) || new Date(data.createdAt).toISOString().slice(0,10) !== data.createdAt) {
    throw new ApiError(400, "Dati cliente non validi.");
  }
  const supplied = data.events === undefined ? [] : data.events;
  if (!Array.isArray(supplied) || supplied.length > 49) throw new ApiError(400, "Il percorso può contenere al massimo 49 fasi successive alla visita.");
  const events = supplied.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new ApiError(400, "Evento non valido.");
    const item = event as Record<string, unknown>;
    if (typeof item.stage !== "string" || item.stage === "visit" ||
        !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.stage) ||
        typeof item.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt) ||
        Number.isNaN(Date.parse(item.occurredAt)) || new Date(item.occurredAt).toISOString().slice(0,10) !== item.occurredAt) {
      throw new ApiError(400, "Evento non valido.");
    }
    return { stage: item.stage, occurredAt: item.occurredAt };
  });
  return {
    externalId: typeof data.externalId === "string" ? data.externalId.trim() : `manual:${randomUUID()}`,
    channel: data.channel,
    createdAt: data.createdAt,
    events: [{ stage: "visit", occurredAt: data.createdAt }, ...events],
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

  app.use((req, res, next) => {
    const declaredLength = Number(req.get("content-length") ?? "0");
    const maximum = req.path === "/api/import" ? 12 * 1024 * 1024 : 1024 * 1024;
    if (Number.isFinite(declaredLength) && declaredLength > maximum) {
      res.status(413).json({ error: "La richiesta supera il limite consentito." });
      return;
    }
    next();
  });
  // Importazioni: limite dedicato; tutte le altre API hanno un limite più restrittivo.
  app.use("/api/import", express.json({ limit: "12mb" }));
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

  const parseAnalyticsFilters = async (req: Request, organizationId: string) => {
    const meta = await getPostgresMeta(pool, organizationId);
    const today = new Date().toISOString().slice(0, 10);
    const from = typeof req.query.from === "string" ? req.query.from : meta.minDate ?? today;
    const to = typeof req.query.to === "string" ? req.query.to : meta.maxDate ?? today;
    const validDate = isValidPostgresDate;
    if (!validDate(from) || !validDate(to) || from > to) throw new ApiError(400, "Intervallo date non valido.");
    const channel = typeof req.query.channel === "string" && req.query.channel ? req.query.channel : undefined;
    if (channel && !(CHANNELS as readonly string[]).includes(channel)) throw new ApiError(400, "Canale non valido.");
    return { from, to, channel };
  };

  app.get("/api/meta", authenticated, requireOrganizationPermission("analytics:read"),
    async (req, res, next) => {
      try { res.json(await getPostgresMeta(pool, req.authenticatedSession!.organizationId)); }
      catch (error) { next(error); }
    });
  app.get("/api/summary", authenticated, requireOrganizationPermission("analytics:read"),
    async (req, res, next) => {
      try {
        const org = req.authenticatedSession!.organizationId;
        res.json(await getPostgresSummary(pool, org, await parseAnalyticsFilters(req, org)));
      } catch (error) { next(error); }
    });
  app.get("/api/channels", authenticated, requireOrganizationPermission("analytics:read"),
    async (req, res, next) => {
      try {
        const org = req.authenticatedSession!.organizationId;
        res.json(await getPostgresChannels(pool, org, await parseAnalyticsFilters(req, org)));
      } catch (error) { next(error); }
    });
  app.get("/api/timeseries", authenticated, requireOrganizationPermission("analytics:read"),
    async (req, res, next) => {
      try {
        const org = req.authenticatedSession!.organizationId;
        res.json(await getPostgresTimeseries(pool, org, await parseAnalyticsFilters(req, org)));
      } catch (error) { next(error); }
    });

  app.post("/api/import", authenticated, requireOrganizationPermission("data:import"),
    async (req, res, next) => {
      try {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
          throw new ApiError(400, "Il corpo della richiesta non è valido.");
        }
        const body = req.body as { fileName?: unknown; rows?: unknown };
        if (typeof body.fileName !== "string" || !Array.isArray(body.rows)) {
          throw new ApiError(400, "File o righe di importazione non validi.");
        }
        const result = await importPostgresCustomers(
          pool, req.authenticatedSession!.organizationId, req.authenticatedSession!.userId,
          body.fileName, body.rows as PostgresImportRow[],
        );
        res.status(201).json(result);
      } catch (error) {
        if (error instanceof PostgresImportError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        const code = (error as { code?: string })?.code;
        if (code === "23505") {
          res.status(409).json({ error: "Un identificativo cliente è già presente nell'organizzazione." });
          return;
        }
        next(error);
      }
    });

  app.get("/api/segments", authenticated, requireOrganizationPermission("analytics:read"),
    async (req, res, next) => {
      try {
        const org = req.authenticatedSession!.organizationId;
        res.json(await getPostgresSegments(pool, org, await parseAnalyticsFilters(req, org)));
      } catch (error) { next(error); }
    });

  app.get("/api/segments/customers", authenticated, requireOrganizationPermission("analytics:read"),
    async (req, res, next) => {
      try {
        const org = req.authenticatedSession!.organizationId;
        const dimension = typeof req.query.dimension === "string" ? req.query.dimension : "";
        const id = typeof req.query.id === "string" ? req.query.id : "";
        const filters = await parseAnalyticsFilters(req, org);
        res.json(await getPostgresSegmentCustomers(pool, org, filters, dimension as SegmentDimension, id));
      } catch (error) { next(error); }
    });

  app.get("/api/export/customers.csv", authenticated, requireOrganizationPermission("data:export"),
    async (req, res, next) => {
      try {
        const result = await exportPostgresCustomersCsv(pool, req.authenticatedSession!.organizationId);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="percorso-clienti.csv"');
        res.setHeader("X-Export-Row-Count", String(result.rowCount));
        res.send(result.csv);
      } catch (error) {
        if (error instanceof PostgresExportError) { res.status(error.status).json({ error: error.message }); return; }
        next(error);
      }
    });

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

  app.put("/api/customers/:id", authenticated,
    requireOrganizationPermission("customers:write"),
    async (req, res, next) => {
      try {
        const input = validateCustomerBody(req.body);
        res.json(await updatePostgresCustomer(pool, req.authenticatedSession!.organizationId, req.params.id, input));
      } catch (error) { next(error); }
    });

  app.delete("/api/customers/:id", authenticated,
    requireOrganizationPermission("customers:write"),
    async (req, res, next) => {
      try {
        await deletePostgresCustomer(pool, req.authenticatedSession!.organizationId, req.params.id);
        res.status(204).send();
      } catch (error) { next(error); }
    });

  app.post("/api/funnel-stages", authenticated,
    requireOrganizationPermission("funnel:write"),
    async (req, res, next) => {
      try {
        const label = (req.body as { label?: unknown } | undefined)?.label;
        if (typeof label !== "string" || !label.trim() || label.trim().length > 50) {
          throw new ApiError(400, "Il nome della fase deve contenere da 1 a 50 caratteri.");
        }
        const created = await createPostgresFunnelStage(pool, req.authenticatedSession!.organizationId, label);
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


  app.get("/api/members", authenticated, requireOrganizationPermission("members:manage"),
    async (req, res, next) => {
      try { res.json(await listOrganizationMembers(pool, req.authenticatedSession!.organizationId)); }
      catch (error) { next(error); }
    });
  app.patch("/api/members/:id", authenticated, requireOrganizationPermission("members:manage"),
    async (req, res, next) => {
      try {
        const body = req.body as Record<string, unknown> | undefined;
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Modifiche membro non valide.");
        const updates: { role?: unknown; status?: unknown } = {};
        if (Object.prototype.hasOwnProperty.call(body, "role")) updates.role = body.role;
        if (Object.prototype.hasOwnProperty.call(body, "status")) updates.status = body.status;
        res.json(await updateOrganizationMember(pool, req.authenticatedSession!.organizationId,
          req.params.id, req.authenticatedSession!.userId, updates));
      } catch (error) {
        if (error instanceof MemberManagementError) { res.status(error.status).json({ error: error.message }); return; }
        next(error);
      }
    });

  app.use((_req, res) => res.status(404).json({ error: "Risorsa non trovata." }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const parserError = error as { type?: string };
    if (parserError?.type === "entity.too.large") {
      res.status(413).json({ error: "La richiesta supera il limite consentito." });
      return;
    }
    if (parserError?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Il corpo JSON non è valido." });
      return;
    }
    if (error instanceof MemberManagementError) { res.status(error.status).json({ error: error.message }); return; }
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
