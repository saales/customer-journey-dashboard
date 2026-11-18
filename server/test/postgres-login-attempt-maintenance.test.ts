import { describe, expect, it, vi } from "vitest";
import { cleanupPostgresLoginAttemptLimits } from "../src/postgres-login-attempt-maintenance.js";

describe("Pulizia tentativi di accesso", () => {
  it("rifiuta retention e batch fuori intervallo prima della query", async () => {
    const query = vi.fn();
    await expect(cleanupPostgresLoginAttemptLimits({ query } as never, 0)).rejects.toThrow("retention");
    await expect(cleanupPostgresLoginAttemptLimits({ query } as never, 7, 10001)).rejects.toThrow("batch");
    expect(query).not.toHaveBeenCalled();
  });

  it("elimina in batch solo i record oltre retention", async () => {
    const query = vi.fn(async () => ({ rows: [{ key_hash: "a" }, { key_hash: "b" }], rowCount: 2 }));
    await expect(cleanupPostgresLoginAttemptLimits({ query } as never, 7, 100)).resolves.toEqual({
      deleted: 2, retentionDays: 7,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("updated_at < NOW()"), [7, 100]);
  });
});
