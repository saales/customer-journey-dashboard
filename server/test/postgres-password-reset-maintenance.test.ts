import { describe, expect, it, vi } from "vitest";
import { cleanupPostgresPasswordResetTokens } from "../src/postgres-password-reset-maintenance.js";

describe("Pulizia token recupero password", () => {
  it("rifiuta batch non validi prima di interrogare il database", async () => {
    const query = vi.fn();
    await expect(cleanupPostgresPasswordResetTokens({ query } as never, 0)).rejects.toThrow("batch");
    await expect(cleanupPostgresPasswordResetTokens({ query } as never, 10001)).rejects.toThrow("batch");
    expect(query).not.toHaveBeenCalled();
  });

  it("elimina in batch solo token consumati o scaduti da almeno un giorno", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "a" }, { id: "b" }], rowCount: 2 }));
    await expect(cleanupPostgresPasswordResetTokens({ query } as never, 100)).resolves.toEqual({
      deleted: 2, batchSize: 100,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("consumed_at IS NOT NULL OR expires_at <= NOW()"), [100]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("created_at < NOW() - INTERVAL '1 day'"), [100]);
  });
});
