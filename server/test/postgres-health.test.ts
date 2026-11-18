import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { verifyPostgresPool } from "../src/postgres-health.js";

describe("verifyPostgresPool", () => {
  it("esegue una query di verifica e rilascia la connessione", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const pool = { connect } as unknown as Pick<Pool, "connect">;

    await expect(verifyPostgresPool(pool)).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith("SELECT 1");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rilascia la connessione anche se la query fallisce", async () => {
    const failure = new Error("database unavailable");
    const query = vi.fn().mockRejectedValue(failure);
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const pool = { connect } as unknown as Pick<Pool, "connect">;

    await expect(verifyPostgresPool(pool)).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
  });

  it("propaga gli errori di acquisizione della connessione", async () => {
    const failure = new Error("pool exhausted");
    const connect = vi.fn().mockRejectedValue(failure);
    const pool = { connect } as unknown as Pick<Pool, "connect">;

    await expect(verifyPostgresPool(pool)).rejects.toBe(failure);
  });
});
