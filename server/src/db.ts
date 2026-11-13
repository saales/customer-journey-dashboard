
import Database from "better-sqlite3";

export type Db = Database.Database;

const DEFAULT_FUNNEL_STAGES = [
  { id: "visit", label: "Visita", position: 0 },
  { id: "lead", label: "Contatto", position: 1 },
  { id: "qualified", label: "Qualificato", position: 2 },
  { id: "opportunity", label: "Opportunità", position: 3 },
  { id: "customer", label: "Cliente", position: 4 },
] as const;

/** Crea lo schema (idempotente). */
export function initSchema(db: Db): void {
  // SQLite disabilita le foreign key per default: abilitarle su ogni connessione
  // prima di creare/usare lo schema, così gli eventi orfani vengono rifiutati.
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id          INTEGER PRIMARY KEY,
      channel     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id  INTEGER NOT NULL REFERENCES customers(id),
      stage        TEXT NOT NULL,
      occurred_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint    TEXT NOT NULL UNIQUE,
      file_name      TEXT NOT NULL,
      customer_count INTEGER NOT NULL,
      row_count      INTEGER NOT NULL,
      imported_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS funnel_stages (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      position    INTEGER NOT NULL UNIQUE,
      is_active   INTEGER NOT NULL DEFAULT 1
                  CHECK (is_active IN (0, 1)),
      is_system   INTEGER NOT NULL DEFAULT 0
                  CHECK (is_system IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_customers_created
      ON customers(created_at);

    CREATE INDEX IF NOT EXISTS idx_customers_channel
      ON customers(channel);

    CREATE INDEX IF NOT EXISTS idx_events_customer
      ON events(customer_id, stage);

    CREATE INDEX IF NOT EXISTS idx_events_customer_timeline
      ON events(customer_id, occurred_at, id);

    CREATE INDEX IF NOT EXISTS idx_funnel_stages_position
      ON funnel_stages(position);
  `);

  initializeFunnelStages(db);
}

/** Inserisce le fasi standard solo se non esistono già. */
export function initializeFunnelStages(db: Db): void {
  const insertStage = db.prepare(`
    INSERT OR IGNORE INTO funnel_stages (
      id,
      label,
      position,
      is_active,
      is_system
    )
    VALUES (?, ?, ?, 1, 1)
  `);

  const initialize = db.transaction(() => {
    for (const stage of DEFAULT_FUNNEL_STAGES) {
      insertStage.run(
        stage.id,
        stage.label,
        stage.position,
      );
    }
  });

  initialize();
}

export function openDb(path = process.env.DB_PATH ?? "journey.db"): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}
