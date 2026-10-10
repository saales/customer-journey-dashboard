import Database from "better-sqlite3";

export type Db = Database.Database;

/** Crea lo schema (idempotente). */
export function initSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id          INTEGER PRIMARY KEY,
      channel     TEXT NOT NULL,
      created_at  TEXT NOT NULL            -- data della prima visita (YYYY-MM-DD)
    );

    CREATE TABLE IF NOT EXISTS events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id  INTEGER NOT NULL REFERENCES customers(id),
      stage        TEXT NOT NULL,          -- visit | lead | qualified | opportunity | customer
      occurred_at  TEXT NOT NULL           -- data dell'evento (YYYY-MM-DD)
    );

    CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at);
    CREATE INDEX IF NOT EXISTS idx_customers_channel ON customers(channel);
    CREATE INDEX IF NOT EXISTS idx_events_customer   ON events(customer_id, stage);
  `);
}

export function openDb(path = process.env.DB_PATH ?? "journey.db"): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}
