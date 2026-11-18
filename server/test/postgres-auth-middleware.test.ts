import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import {
  getPostgresSessionCookieName,
  getRolePermissions,
  requireOrganizationPermission,
  requireOrganizationRole,
  requirePostgresSession,
} from "../src/postgres-auth-middleware.js";

const TOKEN = "A".repeat(43);
const SESSION = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "analyst" as const,
};

function harness(cookie?: string) {
  const req = { headers: { cookie } } as Request;
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  } as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
  const next = vi.fn() as unknown as NextFunction;
  return { req, response, next };
}

function poolReturning(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  const client = { query, release: vi.fn() };
  return { connect: vi.fn().mockResolvedValue(client), query, client } as unknown as Pick<Pool, "connect">;
}

describe("PostgreSQL authentication middleware", () => {
  it("uses a secure host-only cookie name in production", () => {
    expect(getPostgresSessionCookieName(true)).toBe("__Host-percorso_session");
    expect(getPostgresSessionCookieName(false)).toBe("percorso_session");
  });

  it("resolves a valid cookie and attaches the database identity", async () => {
    const pool = poolReturning([SESSION]);
    const { req, response, next } = harness(`percorso_session=${TOKEN}`);
    await requirePostgresSession(pool, "percorso_session")(req, response, next);
    expect(req.authenticatedSession).toEqual(SESSION);
    expect(next).toHaveBeenCalledOnce();
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers.Vary).toBe("Cookie");
  });

  it.each([
    undefined,
    "",
    `percorso_session=${TOKEN}; percorso_session=${TOKEN}`,
    "percorso_session=malformed",
    `other_cookie=${TOKEN}`,
  ])("rejects missing, malformed or ambiguous cookies (%s)", async (cookie) => {
    const pool = poolReturning([]);
    const { req, response, next } = harness(cookie);
    await requirePostgresSession(pool, "percorso_session")(req, response, next);
    expect(response.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rejects a revoked or expired session", async () => {
    const pool = poolReturning([]);
    const { req, response, next } = harness(`percorso_session=${TOKEN}`);
    await requirePostgresSession(pool, "percorso_session")(req, response, next);
    expect(response.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes database failures to centralized error handling", async () => {
    const pool = { connect: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Pick<Pool, "connect">;
    const { req, response, next } = harness(`percorso_session=${TOKEN}`);
    await requirePostgresSession(pool, "percorso_session")(req, response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "database unavailable" }));
    expect(response.statusCode).toBe(200);
  });
});

describe("organization role and permission policy", () => {
  const expectedPermissions = {
    admin: [
      "analytics:read", "customers:read", "customers:write",
      "funnel:read", "funnel:write", "data:import", "data:export",
      "members:manage", "audit:read",
    ],
    editor: [
      "analytics:read", "customers:read", "customers:write",
      "funnel:read", "funnel:write", "data:import", "data:export",
    ],
    analyst: [
      "analytics:read", "customers:read", "funnel:read", "data:export",
    ],
    viewer: [
      "analytics:read", "customers:read", "funnel:read",
    ],
  } as const;

  it.each(Object.entries(expectedPermissions))(
    "applica esattamente le autorizzazioni previste per il ruolo %s",
    (role, expected) => {
      expect([...getRolePermissions(role as keyof typeof expectedPermissions)].sort())
        .toEqual([...expected].sort());
    },
  );

  it("consente a un analista le letture previste e nega le scritture e l'audit", () => {
    const req = { authenticatedSession: SESSION } as Request;
    const response = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json: vi.fn(),
    } as unknown as Response & { statusCode: number };
    const next = vi.fn() as unknown as NextFunction;

    requireOrganizationPermission("analytics:read")(req, response, next);
    expect(next).toHaveBeenCalledOnce();

    for (const permission of ["customers:write", "data:import", "funnel:write", "audit:read"] as const) {
      const deniedNext = vi.fn() as unknown as NextFunction;
      requireOrganizationPermission(permission)(req, response, deniedNext);
      expect(response.statusCode).toBe(403);
      expect(deniedNext).not.toHaveBeenCalled();
    }
  });

  it("non consente richieste prive di contesto autenticato", () => {
    const req = {} as Request;
    const response = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json: vi.fn(),
    } as unknown as Response & { statusCode: number };
    const next = vi.fn() as unknown as NextFunction;
    requireOrganizationRole("admin")(req, response, next);
    expect(response.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
