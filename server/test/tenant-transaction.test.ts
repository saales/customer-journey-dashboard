import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "../src/tenant-transaction.js";

function createPoolMock() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn().mockResolvedValue(client);
  const pool = { connect } as unknown as Pick<Pool, "connect">;
  return { pool, connect, client, query, release };
}

describe("withTenantTransaction", () => {
  it("imposta il tenant localmente e usa lo stesso client fino al commit", async () => {
    const mock = createPoolMock();
    const work = vi.fn().mockResolvedValue("ok");

    await expect(
      withTenantTransaction(mock.pool, "org-a", work),
    ).resolves.toBe("ok");

    expect(mock.connect).toHaveBeenCalledOnce();
    expect(mock.query.mock.calls).toEqual([
      ["BEGIN"],
      ["SELECT set_config('app.organization_id', $1, true)", ["org-a"]],
      ["COMMIT"],
    ]);
    expect(work).toHaveBeenCalledWith(mock.client);
    expect(mock.release).toHaveBeenCalledOnce();
  });

  it("esegue rollback e rilascia il client quando il lavoro fallisce", async () => {
    const mock = createPoolMock();
    const failure = new Error("write failed");
    const work = vi.fn().mockRejectedValue(failure);

    await expect(
      withTenantTransaction(mock.pool, "org-a", work),
    ).rejects.toBe(failure);

    expect(mock.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SELECT set_config('app.organization_id', $1, true)",
      "ROLLBACK",
    ]);
    expect(mock.release).toHaveBeenCalledOnce();
  });

  it("non apre connessioni se il tenant è vuoto", async () => {
    const mock = createPoolMock();

    await expect(
      withTenantTransaction(mock.pool, "  ", async () => undefined),
    ).rejects.toThrow("Contesto organizzazione mancante.");

    expect(mock.connect).not.toHaveBeenCalled();
  });

  it("conserva l'errore originale anche se rollback fallisce", async () => {
    const mock = createPoolMock();
    const failure = new Error("work failed");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return { rows: [] };
    });

    await expect(
      withTenantTransaction(mock.pool, "org-a", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(mock.release).toHaveBeenCalledOnce();
  });
});
