import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initSchema } from "../src/db.js";

describe("SQLite schema constraints", () => {
  it("enables foreign-key enforcement on every initialized connection", () => {
    const db = new Database(":memory:");
    try {
      initSchema(db);

      const settings = db.pragma("foreign_keys") as { foreign_keys: number }[];
      expect(settings[0]?.foreign_keys).toBe(1);

      expect(() => {
        db.prepare(
          "INSERT INTO events (customer_id, stage, occurred_at) VALUES (?, ?, ?)",
        ).run(999999, "lead", "2026-11-13");
      }).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it("allows events linked to an existing customer", () => {
    const db = new Database(":memory:");
    try {
      initSchema(db);
      db.prepare(
        "INSERT INTO customers (id, channel, created_at) VALUES (?, ?, ?)",
      ).run(1, "Email", "2026-11-13");

      expect(() => {
        db.prepare(
          "INSERT INTO events (customer_id, stage, occurred_at) VALUES (?, ?, ?)",
        ).run(1, "visit", "2026-11-13");
      }).not.toThrow();
    } finally {
      db.close();
    }
  });
});
