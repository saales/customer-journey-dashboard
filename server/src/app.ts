import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";
import { getAvgDaysToCustomer, getChannels, getFunnel, getMeta, getTimeseries } from "./queries.js";
import { CHANNELS, type Filters } from "./types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Legge e valida from / to / channel dalla query string. */
function parseFilters(req: Request, db: Db): Filters {
  const meta = getMeta(db);
  const from = String(req.query.from ?? meta.minDate ?? "");
  const to = String(req.query.to ?? meta.maxDate ?? "");

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new HttpError(400, "I parametri 'from' e 'to' devono avere formato YYYY-MM-DD.");
  }
  if (from > to) {
    throw new HttpError(400, "'from' non può essere successivo a 'to'.");
  }

  const channel = req.query.channel ? String(req.query.channel) : undefined;
  if (channel && !(CHANNELS as readonly string[]).includes(channel)) {
    throw new HttpError(400, `Canale non valido. Valori ammessi: ${CHANNELS.join(", ")}.`);
  }
  return { from, to, channel };
}

export function createApp(db: Db) {
  const app = express();

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/meta", (_req, res) => {
    res.json(getMeta(db));
  });

  app.get("/api/summary", (req, res) => {
    const f = parseFilters(req, db);
    const funnel = getFunnel(db, f);
    const visits = funnel[0].count;
    const customers = funnel[funnel.length - 1].count;
    res.json({
      filters: f,
      funnel,
      kpis: {
        visits,
        leads: funnel[1].count,
        customers,
        conversionRate: funnel[funnel.length - 1].conversionFromVisit,
        avgDaysToCustomer: getAvgDaysToCustomer(db, f),
      },
    });
  });

  app.get("/api/channels", (req, res) => {
    res.json(getChannels(db, parseFilters(req, db)));
  });

  app.get("/api/timeseries", (req, res) => {
    res.json(getTimeseries(db, parseFilters(req, db)));
  });

  // In produzione serve anche il front end compilato
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // Gestione centralizzata degli errori
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Errore interno del server." });
  });

  return app;
}
