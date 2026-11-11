import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";
import { getAvgDaysToCustomer, getChannels, getFunnel, getMeta, getTimeseries } from "./queries.js";
import {
  CHANNELS,
  STAGES,
  type Filters,
  type Stage,
} from "./types.js";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

interface CreateCustomerEvent {
  stage: string;
  occurredAt: string;
}

function validateCreateCustomer(body: unknown): CreateCustomerBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Il corpo della richiesta deve essere un oggetto JSON.");
  }

  const data = body as Record<string, unknown>;

  if (
    typeof data.channel !== "string" ||
    !(CHANNELS as readonly string[]).includes(data.channel)
  ) {
    throw new HttpError(400, "Canale non valido.");
  }

  if (!isValidDate(data.createdAt)) {
    throw new HttpError(400, "Data di prima visita non valida.");
  }

  const events = data.events ?? [];

  if (!Array.isArray(events)) {
    throw new HttpError(400, "Gli eventi devono essere un array.");
  }

  const validatedEvents: CreateCustomerEvent[] = [];
  let previousStageIndex = 0;
  let previousDate = data.createdAt;

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new HttpError(400, "Evento non valido.");
    }

    const item = event as Record<string, unknown>;

    if (
      typeof item.stage !== "string" ||
      !(STAGES as readonly string[]).includes(item.stage)
    ) {
      throw new HttpError(400, "Fase del percorso non valida.");
    }

    const stageIndex = STAGES.indexOf(item.stage as Stage);

    if (stageIndex <= previousStageIndex) {
      throw new HttpError(400, "Le fasi devono essere uniche e seguire l'ordine del percorso.");
    }

    if (!isValidDate(item.occurredAt)) {
      throw new HttpError(400, "Data dell'evento non valida.");
    }

    if (item.occurredAt < previousDate) {
      throw new HttpError(400, "La data di un evento non può precedere quella della fase precedente.");
    }

    validatedEvents.push({
      stage: item.stage,
      occurredAt: item.occurredAt,
    });

    previousStageIndex = stageIndex;
    previousDate = item.occurredAt;
  }

  return {
    channel: data.channel,
    createdAt: data.createdAt,
    events: validatedEvents,
  };
}

interface CreateCustomerBody {
  channel: string;
  createdAt: string;
  events?: CreateCustomerEvent[];
}

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
  app.disable("x-powered-by");

  app.use(express.json({ limit: "100kb" }));

  // Header di sicurezza di base
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

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

  app.post("/api/customers", (req, res) => {
  const customer = validateCreateCustomer(req.body);

  const insertCustomer = db.prepare(`
    INSERT INTO customers (channel, created_at)
    VALUES (@channel, @createdAt)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO events (customer_id, stage, occurred_at)
    VALUES (@customerId, @stage, @occurredAt)
  `);

  const create = db.transaction(() => {
    const result = insertCustomer.run({
      channel: customer.channel,
      createdAt: customer.createdAt,
    });

    const customerId = Number(result.lastInsertRowid);

    insertEvent.run({
      customerId,
      stage: "visit",
      occurredAt: customer.createdAt,
    });

    for (const event of customer.events ?? []) {
      insertEvent.run({
        customerId,
        stage: event.stage,
        occurredAt: event.occurredAt,
      });
    }

    return customerId;
  });

  const id = create();

  res.status(201).json({
    id,
    channel: customer.channel,
    createdAt: customer.createdAt,
    events: [
      { stage: "visit", occurredAt: customer.createdAt },
      ...(customer.events ?? []),
    ],
  });
});


app.get("/api/customers", (_req, res) => {
  const customers = db.prepare(`
    SELECT
      id,
      channel,
      created_at AS createdAt
    FROM customers
    ORDER BY id DESC
  `).all() as {
    id: number;
    channel: string;
    createdAt: string;
  }[];

  const getEvents = db.prepare(`
    SELECT
      stage,
      occurred_at AS occurredAt
    FROM events
    WHERE customer_id = ?
    ORDER BY occurred_at ASC, id ASC
  `);

  const result = customers.map((customer) => {
    const events = getEvents.all(customer.id);

    return {
      ...customer,
      events,
    };
  });

  res.json(result);
});

app.put("/api/customers/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "ID cliente non valido.");
  }

  const customer = validateCreateCustomer(req.body);

  const update = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id FROM customers WHERE id = ?
    `).get(id);

    if (!existing) {
      return false;
    }

    db.prepare(`
      UPDATE customers
      SET channel = @channel,
          created_at = @createdAt
      WHERE id = @id
    `).run({
      id,
      channel: customer.channel,
      createdAt: customer.createdAt,
    });

    db.prepare(`
      DELETE FROM events WHERE customer_id = ?
    `).run(id);

    const insertEvent = db.prepare(`
      INSERT INTO events (customer_id, stage, occurred_at)
      VALUES (@customerId, @stage, @occurredAt)
    `);

    insertEvent.run({
      customerId: id,
      stage: "visit",
      occurredAt: customer.createdAt,
    });

    for (const event of customer.events ?? []) {
      insertEvent.run({
        customerId: id,
        stage: event.stage,
        occurredAt: event.occurredAt,
      });
    }

    return true;
  });

  const updated = update();

  if (!updated) {
    res.status(404).json({ error: "Cliente non trovato." });
    return;
  }

  res.json({
    id,
    channel: customer.channel,
    createdAt: customer.createdAt,
    events: [
      { stage: "visit", occurredAt: customer.createdAt },
      ...(customer.events ?? []),
    ],
  });
});

app.delete("/api/customers/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "ID cliente non valido.");
  }

  const remove = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id FROM customers WHERE id = ?
    `).get(id);

    if (!existing) {
      return false;
    }

    db.prepare(`
      DELETE FROM events WHERE customer_id = ?
    `).run(id);

    db.prepare(`
      DELETE FROM customers WHERE id = ?
    `).run(id);

    return true;
  });

  const deleted = remove();

  if (!deleted) {
    res.status(404).json({ error: "Cliente non trovato." });
    return;
  }

  res.status(204).send();
});

  // Qualsiasi altra rotta /api risponde con un 404 in formato JSON
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Risorsa non trovata." });
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
