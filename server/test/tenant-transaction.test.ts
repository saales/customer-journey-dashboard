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
      ["SELECT set_config('app.current_organization_id', $1, true)", ["org-a"]],
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
      "SELECT set_config('app.current_organization_id', $1, true)",
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

  it("distrugge il client se rollback fallisce e conserva l'errore originale", async () => {
    const mock = createPoolMock();
    const failure = new Error("work failed");
    const rollbackFailure = new Error("rollback failed");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw rollbackFailure;
      return { rows: [] };
    });

    await expect(
      withTenantTransaction(mock.pool, "org-a", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.release).toHaveBeenCalledWith(true);
  });
  it("esegue rollback se non riesce a impostare il contesto tenant", async () => {
    const mock = createPoolMock();
    const failure = new Error("tenant context setup failed");
    const work = vi.fn().mockResolvedValue("must not run");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT set_config")) throw failure;
      return { rows: [] };
    });

    await expect(
      withTenantTransaction(mock.pool, "org-a", work),
    ).rejects.toBe(failure);

    expect(work).not.toHaveBeenCalled();
    expect(mock.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SELECT set_config('app.current_organization_id', $1, true)",
      "ROLLBACK",
    ]);
    expect(mock.query.mock.calls[1][1]).toEqual(["org-a"]);
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("rilascia il client senza rollback se BEGIN fallisce", async () => {
    const mock = createPoolMock();
    const failure = new Error("begin failed");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN") throw failure;
      return { rows: [] };
    });

    await expect(
      withTenantTransaction(mock.pool, "org-a", async () => "unreachable"),
    ).rejects.toBe(failure);

    expect(mock.query.mock.calls).toEqual([["BEGIN"]]);
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.release).toHaveBeenCalledWith(false);
  });

  it("esegue rollback se COMMIT fallisce e conserva l'errore del commit", async () => {
    const mock = createPoolMock();
    const failure = new Error("commit failed");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw failure;
      return { rows: [] };
    });

    await expect(
      withTenantTransaction(mock.pool, "org-a", async () => "done"),
    ).rejects.toBe(failure);

    expect(mock.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SELECT set_config('app.current_organization_id', $1, true)",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.release).toHaveBeenCalledWith(false);
  });


  it("distrugge il client se falliscono sia COMMIT sia ROLLBACK", async () => {
    const mock = createPoolMock();
    const commitFailure = new Error("commit connection lost");
    const rollbackFailure = new Error("rollback connection lost");
    mock.query.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw commitFailure;
      if (sql === "ROLLBACK") throw rollbackFailure;
      return { rows: [] };
    });

    await expect(
      withTenantTransaction(mock.pool, "org-a", async () => "done"),
    ).rejects.toBe(commitFailure);

    expect(mock.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SELECT set_config('app.current_organization_id', $1, true)",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.release).toHaveBeenCalledWith(true);
  });

  it("imposta REPEATABLE READ prima del contesto tenant e del lavoro", async () => {
    const mock = createPoolMock();
    const work = vi.fn().mockResolvedValue("snapshot");

    await expect(
      withTenantTransaction(mock.pool, "org-a", work, { isolationLevel: "REPEATABLE READ" }),
    ).resolves.toBe("snapshot");

    expect(mock.query.mock.calls).toEqual([
      ["BEGIN"],
      ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"],
      ["SELECT set_config('app.current_organization_id', $1, true)", ["org-a"]],
      ["COMMIT"],
    ]);
    expect(work).toHaveBeenCalledWith(mock.client);
  });

});
