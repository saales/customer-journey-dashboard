
import express, { type NextFunction, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";
import {
  getAvgDaysToCustomer,
  getChannels,
  getFunnel,
  getMeta,
  getTimeseries,
  getSegments,
  getSegmentCustomers,
  type SegmentDimension,
} from "./queries.js";
import {
  CHANNELS,
  type Filters,
} from "./types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMPORT_ROWS = 10000;

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

interface CreateCustomerBody {
  channel: string;
  createdAt: string;
  events?: CreateCustomerEvent[];
}

interface ImportRow {
  externalId: string;
  channel: string;
  createdAt: string;
  stage: string;
  occurredAt: string;
}

interface ImportCustomer {
  externalId: string;
  channel: string;
  createdAt: string;
  events: ImportRow[];
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface FunnelStageRecord {
  id: string;
  label: string;
  position: number;
  isActive: number;
  isSystem: number;
}

function getActiveStages(db: Db): FunnelStageRecord[] {
  return db.prepare(`
    SELECT
      id,
      label,
      position,
      is_active AS isActive,
      is_system AS isSystem
    FROM funnel_stages
    WHERE is_active = 1
    ORDER BY position ASC
  `).all() as FunnelStageRecord[];
}

function getStageIndex(
  stages: FunnelStageRecord[],
  stage: string,
): number {
  return stages.findIndex((item) => item.id === stage);
}

function validateCreateCustomer(
  body: unknown,
  db: Db,
): CreateCustomerBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "Il corpo della richiesta deve essere un oggetto JSON.",
    );
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

  const stages = getActiveStages(db);
  const visitIndex = getStageIndex(stages, "visit");

  if (visitIndex !== 0) {
    throw new HttpError(500, "Configurazione delle fasi non valida.");
  }

  const events = data.events ?? [];

  if (!Array.isArray(events)) {
    throw new HttpError(400, "Gli eventi devono essere un array.");
  }

  const validatedEvents: CreateCustomerEvent[] = [];
  let previousStageIndex = visitIndex;
  let previousDate = data.createdAt;
  const seenStages = new Set<string>(["visit"]);

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new HttpError(400, "Evento non valido.");
    }

    const item = event as Record<string, unknown>;

    if (typeof item.stage !== "string") {
      throw new HttpError(400, "Fase del percorso non valida.");
    }

    const stageIndex = getStageIndex(stages, item.stage);

    if (stageIndex === -1) {
      throw new HttpError(
        400,
        `La fase ${item.stage} non esiste o non è attiva.`,
      );
    }

    if (
      stageIndex <= previousStageIndex ||
      seenStages.has(item.stage)
    ) {
      throw new HttpError(
        400,
        "Le fasi devono essere uniche e seguire l'ordine del percorso.",
      );
    }

    if (!isValidDate(item.occurredAt)) {
      throw new HttpError(400, "Data dell'evento non valida.");
    }

    if (item.occurredAt < previousDate) {
      throw new HttpError(
        400,
        "La data di un evento non può precedere quella della fase precedente.",
      );
    }

    validatedEvents.push({
      stage: item.stage,
      occurredAt: item.occurredAt,
    });

    seenStages.add(item.stage);
    previousStageIndex = stageIndex;
    previousDate = item.occurredAt;
  }

  return {
    channel: data.channel,
    createdAt: data.createdAt,
    events: validatedEvents,
  };
}

/** Valida e raggruppa le righe del CSV per cliente. */
function validateImport(
  body: unknown,
  db: Db,
): {
  fileName: string;
  rows: ImportRow[];
  customers: ImportCustomer[];
  fingerprint: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Il corpo della richiesta non è valido.");
  }

  const data = body as Record<string, unknown>;

  if (
    typeof data.fileName !== "string" ||
    !data.fileName.trim() ||
    data.fileName.length > 255
  ) {
    throw new HttpError(400, "Nome del file non valido.");
  }

  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    throw new HttpError(400, "Il file non contiene righe da importare.");
  }

  if (data.rows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      400,
      `Il file supera il limite di ${MAX_IMPORT_ROWS} righe.`,
    );
  }

  const stages = getActiveStages(db);

  if (getStageIndex(stages, "visit") !== 0) {
    throw new HttpError(500, "Configurazione delle fasi non valida.");
  }

  const rows: ImportRow[] = [];

  for (let index = 0; index < data.rows.length; index++) {
    const item = data.rows[index];

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `Riga ${index + 2}: formato non valido.`);
    }

    const row = item as Record<string, unknown>;

    const externalId =
      typeof row.externalId === "string" ? row.externalId.trim() : "";
    const channel =
      typeof row.channel === "string" ? row.channel.trim() : "";
    const createdAt =
      typeof row.createdAt === "string" ? row.createdAt.trim() : "";
    const stage =
      typeof row.stage === "string" ? row.stage.trim() : "";
    const occurredAt =
      typeof row.occurredAt === "string" ? row.occurredAt.trim() : "";

    const rowNumber = index + 2;

    if (!externalId || externalId.length > 100) {
      throw new HttpError(
        400,
        `Riga ${rowNumber}: identificativo cliente mancante o troppo lungo.`,
      );
    }

    if (!(CHANNELS as readonly string[]).includes(channel)) {
      throw new HttpError(400, `Riga ${rowNumber}: canale non valido.`);
    }

    if (!isValidDate(createdAt)) {
      throw new HttpError(
        400,
        `Riga ${rowNumber}: data di ingresso non valida.`,
      );
    }

    if (getStageIndex(stages, stage) === -1) {
      throw new HttpError(
        400,
        `Riga ${rowNumber}: fase ${stage || "non specificata"} non valida o non attiva.`,
      );
    }

    if (!isValidDate(occurredAt)) {
      throw new HttpError(
        400,
        `Riga ${rowNumber}: data dell'evento non valida.`,
      );
    }

    if (occurredAt < createdAt) {
      throw new HttpError(
        400,
        `Riga ${rowNumber}: l'evento precede la data di ingresso.`,
      );
    }

    rows.push({
      externalId,
      channel,
      createdAt,
      stage,
      occurredAt,
    });
  }

  const groups = new Map<string, ImportCustomer>();

  for (const row of rows) {
    const existing = groups.get(row.externalId);

    if (!existing) {
      groups.set(row.externalId, {
        externalId: row.externalId,
        channel: row.channel,
        createdAt: row.createdAt,
        events: [row],
      });
      continue;
    }

    if (existing.channel !== row.channel) {
      throw new HttpError(
        400,
        `Il cliente ${row.externalId} ha canali differenti.`,
      );
    }

    if (existing.createdAt !== row.createdAt) {
      throw new HttpError(
        400,
        `Il cliente ${row.externalId} ha date di ingresso differenti.`,
      );
    }

    existing.events.push(row);
  }

  const customers = [...groups.values()];

  for (const customer of customers) {
    customer.events.sort(
      (a, b) =>
        getStageIndex(stages, a.stage) -
        getStageIndex(stages, b.stage),
    );

    const seenStages = new Set<string>();
    let previousDate = customer.createdAt;
    let previousStageIndex = -1;

    if (!customer.events.some((event) => event.stage === "visit")) {
      throw new HttpError(
        400,
        `Il cliente ${customer.externalId} non contiene la fase visit.`,
      );
    }

    for (const event of customer.events) {
      const stageIndex = getStageIndex(stages, event.stage);

      if (stageIndex === -1 || stageIndex <= previousStageIndex) {
        throw new HttpError(
          400,
          `Il cliente ${customer.externalId} contiene fasi non valide o fuori ordine.`,
        );
      }

      if (seenStages.has(event.stage)) {
        throw new HttpError(
          400,
          `Il cliente ${customer.externalId} contiene la fase ${event.stage} più di una volta.`,
        );
      }

      seenStages.add(event.stage);

      if (
        event.stage === "visit" &&
        event.occurredAt !== customer.createdAt
      ) {
        throw new HttpError(
          400,
          `La fase visit del cliente ${customer.externalId} deve coincidere con la data di ingresso.`,
        );
      }

      if (event.occurredAt < previousDate) {
        throw new HttpError(
          400,
          `Le date degli eventi del cliente ${customer.externalId} non rispettano l'ordine cronologico.`,
        );
      }

      previousStageIndex = stageIndex;
      previousDate = event.occurredAt;
    }
  }

  // L'impronta non dipende dal nome del file né dall'ordine delle righe.
  const canonicalRows = [...rows].sort(
    (a, b) =>
      a.externalId.localeCompare(b.externalId) ||
      getStageIndex(stages, a.stage) - getStageIndex(stages, b.stage),
  );

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonicalRows))
    .digest("hex");

  return {
    fileName: data.fileName.trim(),
    rows,
    customers,
    fingerprint,
  };
}

/** Legge e valida from / to / channel dalla query string. */
function parseFilters(req: Request, db: Db): Filters {
  const meta = getMeta(db);
  // Le organizzazioni appena create possono essere vuote: in questo caso
  // usiamo la data corrente come intervallo neutro, così le API restituiscono
  // aggregazioni a zero invece di un errore 400.
  const today = new Date().toISOString().slice(0, 10);
  const from = String(req.query.from ?? meta.minDate ?? today);
  const to = String(req.query.to ?? meta.maxDate ?? today);

  if (!isValidDate(from) || !isValidDate(to)) {
    throw new HttpError(
      400,
      "I parametri 'from' e 'to' devono avere formato YYYY-MM-DD.",
    );
  }

  if (from > to) {
    throw new HttpError(400, "'from' non può essere successivo a 'to'.");
  }

  const channel = req.query.channel
    ? String(req.query.channel)
    : undefined;

  if (channel && !(CHANNELS as readonly string[]).includes(channel)) {
    throw new HttpError(
      400,
      `Canale non valido. Valori ammessi: ${CHANNELS.join(", ")}.`,
    );
  }

  return { from, to, channel };
}

export function createApp(db: Db) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "12mb" }));

  // Header di sicurezza di base
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/api/health", (_req, res) => {
    // Liveness + readiness minima: non basta che Express risponda,
    // anche il database deve essere interrogabile.
    try {
      db.prepare("SELECT 1 AS ready").get();
      res.json({ status: "ok", database: "connected" });
    } catch {
      res.status(503).json({
        status: "error",
        database: "unavailable",
      });
    }
  });

  app.get("/api/meta", (_req, res) => {
    res.json(getMeta(db));
  });

  app.get("/api/funnel-stages", (_req, res) => {
    const stages = db.prepare(`
      SELECT
        id,
        label,
        position,
        is_active AS isActive,
        is_system AS isSystem
      FROM funnel_stages
      ORDER BY position ASC
    `).all() as {
      id: string;
      label: string;
      position: number;
      isActive: number;
      isSystem: number;
    }[];

    res.json(
      stages.map((stage) => ({
        ...stage,
        isActive: stage.isActive === 1,
        isSystem: stage.isSystem === 1,
      })),
    );
  });

  app.put("/api/funnel-stages/reorder", (req, res) => {
    const stageIds = req.body?.stages;

    if (!Array.isArray(stageIds) || stageIds.some(
      (id: unknown) => typeof id !== "string"
    )) {
      throw new HttpError(400, "Elenco delle fasi non valido.");
    }

    const currentStages = db.prepare(`
      SELECT id
      FROM funnel_stages
      ORDER BY position ASC
    `).all() as { id: string }[];

    const currentIds = currentStages.map((stage) => stage.id);

    if (
      stageIds.length !== currentIds.length ||
      new Set(stageIds).size !== currentIds.length ||
      !currentIds.every((id) => stageIds.includes(id))
    ) {
      throw new HttpError(
        400,
        "L'elenco deve contenere tutte le fasi esistenti, una sola volta."
      );
    }

    if (stageIds[0] !== "visit" || stageIds[stageIds.length - 1] !== "customer") {
      throw new HttpError(
        400,
        "Visita deve essere la prima fase e Cliente l'ultima."
      );
    }

    const reorderStages = db.transaction(() => {
      const updatePosition = db.prepare(`
        UPDATE funnel_stages
        SET position = ?
        WHERE id = ?
      `);

      currentIds.forEach((id, index) => {
        updatePosition.run(-(index + 1), id);
      });

      stageIds.forEach((id: string, index: number) => {
        updatePosition.run(index, id);
      });
    });

    reorderStages();

    const stages = db.prepare(`
      SELECT
        id,
        label,
        position,
        is_active AS isActive,
        is_system AS isSystem
      FROM funnel_stages
      ORDER BY position ASC
    `).all() as {
      id: string;
      label: string;
      position: number;
      isActive: number;
      isSystem: number;
    }[];

    res.json(stages.map((stage) => ({
      ...stage,
      isActive: Boolean(stage.isActive),
      isSystem: Boolean(stage.isSystem),
    })));
  });

  app.put("/api/funnel-stages/:id", (req, res) => {
    const { id } = req.params;

    const existing = db.prepare(`
      SELECT id, label, is_active AS isActive, is_system AS isSystem
      FROM funnel_stages
      WHERE id = ?
    `).get(id) as
      | {
          id: string;
          label: string;
          isActive: number;
          isSystem: number;
        }
      | undefined;

    if (!existing) {
      throw new HttpError(404, "Fase del funnel non trovata.");
    }

    const updates: { label?: string; isActive?: boolean } = {};

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "label")) {
      const label =
        typeof req.body.label === "string" ? req.body.label.trim() : "";

      if (!label || label.length > 50) {
        throw new HttpError(
          400,
          "Il nome della fase deve contenere da 1 a 50 caratteri."
        );
      }

      const duplicate = db.prepare(`
        SELECT id
        FROM funnel_stages
        WHERE LOWER(label) = LOWER(?) AND id != ?
      `).get(label, id);

      if (duplicate) {
        throw new HttpError(409, "Esiste già una fase con questo nome.");
      }

      updates.label = label;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "isActive")) {
      if (typeof req.body.isActive !== "boolean") {
        throw new HttpError(400, "Il campo isActive deve essere booleano.");
      }

      if (!req.body.isActive && (id === "visit" || id === "customer")) {
        throw new HttpError(
          400,
          "Le fasi Visita e Cliente non possono essere disattivate."
        );
      }

      updates.isActive = req.body.isActive;
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "Nessuna modifica valida da applicare.");
    }

    db.prepare(`
      UPDATE funnel_stages
      SET
        label = COALESCE(?, label),
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      updates.label ?? null,
      updates.isActive === undefined ? null : Number(updates.isActive),
      id
    );

    const updated = db.prepare(`
      SELECT
        id,
        label,
        position,
        is_active AS isActive,
        is_system AS isSystem
      FROM funnel_stages
      WHERE id = ?
    `).get(id) as {
      id: string;
      label: string;
      position: number;
      isActive: number;
      isSystem: number;
    };

    res.json({
      ...updated,
      isActive: Boolean(updated.isActive),
      isSystem: Boolean(updated.isSystem),
    });
  });

  app.post("/api/funnel-stages", (req, res) => {
    const label =
      typeof req.body?.label === "string"
        ? req.body.label.trim()
        : "";

    if (!label || label.length > 50) {
      throw new HttpError(
        400,
        "Il nome della fase deve contenere da 1 a 50 caratteri.",
      );
    }

    const createStage = db.transaction(() => {
      const duplicate = db.prepare(`
        SELECT id
        FROM funnel_stages
        WHERE LOWER(label) = LOWER(?)
      `).get(label);

      if (duplicate) {
        throw new HttpError(
          409,
          "Esiste già una fase con questo nome.",
        );
      }

      const stages = db.prepare(`
        SELECT id, position
        FROM funnel_stages
        ORDER BY position ASC
      `).all() as {
        id: string;
        position: number;
      }[];

      const customerIndex = stages.findIndex(
        (stage) => stage.id === "customer",
      );

      if (
        customerIndex === -1 ||
        stages[0]?.id !== "visit"
      ) {
        throw new HttpError(
          500,
          "Configurazione delle fasi non valida.",
        );
      }

      const id = `custom_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

      const updatePosition = db.prepare(`
        UPDATE funnel_stages
        SET position = ?
        WHERE id = ?
      `);

      for (const stage of stages) {
        updatePosition.run(-(stage.position + 1), stage.id);
      }

      const insertStage = db.prepare(`
        INSERT INTO funnel_stages (
          id,
          label,
          position,
          is_active,
          is_system
        )
        VALUES (?, ?, ?, 1, 0)
      `);

      for (let i = 0; i < stages.length; i++) {
        if (i === customerIndex) {
          insertStage.run(id, label, i);
        }

        updatePosition.run(
          i < customerIndex ? i : i + 1,
          stages[i].id,
        );
      }

      return {
        id,
        label,
        position: customerIndex,
        isActive: true,
        isSystem: false,
      };
    });

    const stage = createStage();

    res.status(201).json(stage);
  });

  app.get("/api/summary", (req, res) => {
    const f = parseFilters(req, db);
    const funnel = getFunnel(db, f);

    const visits =
      funnel.find((step) => step.stage === "visit")?.count ?? 0;
    const customers =
      funnel.find((step) => step.stage === "customer")?.count ?? 0;
    const conversionRate =
      funnel.find((step) => step.stage === "customer")
        ?.conversionFromVisit ?? 0;

    // Il KPI Lead conta anche gli eventi storici di una fase disattivata.
    const leadSql = `
      SELECT COUNT(DISTINCT e.customer_id) AS count
      FROM events e
      JOIN customers c ON c.id = e.customer_id
      WHERE e.stage = 'lead'
        AND c.created_at BETWEEN ? AND ?
        ${f.channel ? "AND c.channel = ?" : ""}
    `;

    const leadParams = f.channel
      ? [f.from, f.to, f.channel]
      : [f.from, f.to];

    const leadResult = db.prepare(leadSql).get(...leadParams) as {
      count: number;
    };

    res.json({
      filters: f,
      funnel,
      kpis: {
        visits,
        leads: leadResult.count,
        customers,
        conversionRate,
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

  /* ---------------------------------------------------------------------- */
  /* Segmentazione                                                          */
  /* ---------------------------------------------------------------------- */

  app.get("/api/segments", (req, res) => {
    const filters = parseFilters(req, db);

    res.json(getSegments(db, filters));
  });

  app.get("/api/segments/customers", (req, res) => {
    const filters = parseFilters(req, db);

    const dimension = String(req.query.dimension ?? "");
    const segmentId = String(req.query.id ?? "");

    const allowedDimensions: SegmentDimension[] = [
      "channel",
      "stage",
      "period",
      "combination",
    ];

    if (!allowedDimensions.includes(dimension as SegmentDimension)) {
      throw new HttpError(
        400,
        "Dimensione del segmento non valida.",
      );
    }

    if (!segmentId.trim() || segmentId.length > 255) {
      throw new HttpError(
        400,
        "Identificativo del segmento non valido.",
      );
    }

    const customers = getSegmentCustomers(
      db,
      filters,
      dimension as SegmentDimension,
      segmentId,
    );

    res.json(customers);
  });

  app.post("/api/customers", (req, res) => {
    const customer = validateCreateCustomer(req.body, db);

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

  app.post("/api/import", (req, res) => {
    const imported = validateImport(req.body, db);

    const importData = db.transaction(() => {
      const alreadyImported = db.prepare(`
        SELECT id
        FROM import_batches
        WHERE fingerprint = ?
      `).get(imported.fingerprint);

      if (alreadyImported) {
        throw new HttpError(
          409,
          "Questo contenuto è già stato importato.",
        );
      }

      const insertCustomer = db.prepare(`
        INSERT INTO customers (channel, created_at)
        VALUES (@channel, @createdAt)
      `);

      const insertEvent = db.prepare(`
        INSERT INTO events (customer_id, stage, occurred_at)
        VALUES (@customerId, @stage, @occurredAt)
      `);

      let importedEvents = 0;

      for (const customer of imported.customers) {
        const result = insertCustomer.run({
          channel: customer.channel,
          createdAt: customer.createdAt,
        });

        const customerId = Number(result.lastInsertRowid);

        for (const event of customer.events) {
          insertEvent.run({
            customerId,
            stage: event.stage,
            occurredAt: event.occurredAt,
          });

          importedEvents++;
        }
      }

      const batchResult = db.prepare(`
        INSERT INTO import_batches (
          fingerprint,
          file_name,
          customer_count,
          row_count
        )
        VALUES (?, ?, ?, ?)
      `).run(
        imported.fingerprint,
        imported.fileName,
        imported.customers.length,
        imported.rows.length,
      );

      return {
        batchId: Number(batchResult.lastInsertRowid),
        importedCustomers: imported.customers.length,
        importedRows: imported.rows.length,
        importedEvents,
      };
    });

    const result = importData();

    res.status(201).json({
      message: "Importazione completata.",
      ...result,
    });
  });

  app.get("/api/customers", (req, res) => {
    const parsedPage = Number(req.query.page ?? 1);
    const parsedLimit = Number(req.query.limit ?? 50);

    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new HttpError(400, "Parametro page non valido.");
    }
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new HttpError(400, "Parametro limit non valido (valori ammessi: 1-100).");
    }

    const totalRow = db.prepare("SELECT COUNT(*) AS total FROM customers").get() as { total: number };
    const total = totalRow.total;
    const offset = (parsedPage - 1) * parsedLimit;

    const customers = db.prepare(`
      SELECT id, channel, created_at AS createdAt
      FROM customers
      ORDER BY id DESC
      LIMIT @limit OFFSET @offset
    `).all({ limit: parsedLimit, offset }) as {
      id: number;
      channel: string;
      createdAt: string;
    }[];

    // Carica gli eventi di tutta la pagina con una sola query, evitando
    // il pattern N+1 (una query aggiuntiva per ogni cliente).
    const eventsByCustomer = new Map<number, {
      stage: string;
      occurredAt: string;
    }[]>();

    if (customers.length > 0) {
      const placeholders = customers.map(() => "?").join(", ");
      const events = db.prepare(`
        SELECT
          customer_id AS customerId,
          stage,
          occurred_at AS occurredAt
        FROM events
        WHERE customer_id IN (${placeholders})
        ORDER BY customer_id ASC, occurred_at ASC, id ASC
      `).all(...customers.map((customer) => customer.id)) as {
        customerId: number;
        stage: string;
        occurredAt: string;
      }[];

      for (const event of events) {
        const customerEvents = eventsByCustomer.get(event.customerId) ?? [];
        customerEvents.push({
          stage: event.stage,
          occurredAt: event.occurredAt,
        });
        eventsByCustomer.set(event.customerId, customerEvents);
      }
    }

    const result = customers.map((customer) => ({
      ...customer,
      events: eventsByCustomer.get(customer.id) ?? [],
    }));

    res.json({
      data: result,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit),
      },
    });
  });

  app.put("/api/customers/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new HttpError(400, "ID cliente non valido.");
    }

    const customer = validateCreateCustomer(req.body, db);

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

  // Qualsiasi altra rotta /api risponde con un 404 JSON
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Risorsa non trovata." });
  });

  // In produzione serve anche il front end compilato
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../client/dist",
  );

  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) =>
      res.sendFile(path.join(dist, "index.html")),
    );
  }

  // Gestione centralizzata degli errori
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }

      console.error(err);
      res.status(500).json({ error: "Errore interno del server." });
    },
  );

  return app;
}
