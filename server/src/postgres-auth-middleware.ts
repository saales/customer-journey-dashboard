import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import {
  resolvePostgresSession,
  type AuthenticatedSession,
  type OrganizationRole,
} from "./postgres-session-resolver.js";

declare global {
  namespace Express {
    interface Request {
      authenticatedSession?: AuthenticatedSession;
    }
  }
}

export type OrganizationPermission =
  | "analytics:read"
  | "customers:read"
  | "customers:write"
  | "funnel:read"
  | "funnel:write"
  | "data:import"
  | "data:export"
  | "members:manage"
  | "audit:read";

const ROLE_PERMISSIONS: Record<OrganizationRole, ReadonlySet<OrganizationPermission>> = {
  admin: new Set([
    "analytics:read", "customers:read", "customers:write",
    "funnel:read", "funnel:write", "data:import", "data:export",
    "members:manage", "audit:read",
  ]),
  editor: new Set([
    "analytics:read", "customers:read", "customers:write",
    "funnel:read", "funnel:write", "data:import", "data:export",
  ]),
  analyst: new Set([
    "analytics:read", "customers:read", "funnel:read", "data:export",
  ]),
  viewer: new Set([
    "analytics:read", "customers:read", "funnel:read",
  ]),
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Cookie di sessione senza fallback a token nell'URL o nel corpo della richiesta. */
export function getPostgresSessionCookieName(
  production = process.env.NODE_ENV === "production",
): string {
  return production ? "__Host-percorso_session" : "percorso_session";
}

function readSessionCookie(header: string | undefined, cookieName: string): string | null {
  if (!header) return null;
  const matches: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === cookieName) {
      matches.push(part.slice(separator + 1).trim());
    }
  }
  if (matches.length !== 1 || !TOKEN_RE.test(matches[0])) return null;
  return matches[0];
}

/**
 * Resolves the opaque HttpOnly cookie into a server-trusted identity.
 * The organization and role always come from the active database membership.
 */
export function requirePostgresSession(
  pool: Pick<Pool, "connect">,
  cookieName = getPostgresSessionCookieName(),
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
    const token = readSessionCookie(req.headers.cookie, cookieName);
    if (!token) {
      res.status(401).json({ error: "Accesso richiesto." });
      return;
    }

    try {
      const session = await resolvePostgresSession(pool, token);
      if (!session) {
        res.status(401).json({ error: "Sessione non valida o scaduta." });
        return;
      }
      req.authenticatedSession = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Restricts a route to an explicit set of organization roles. */
export function requireOrganizationRole(
  ...allowedRoles: OrganizationRole[]
): RequestHandler {
  const allowed = new Set(allowedRoles);
  return (req, res, next) => {
    const session = req.authenticatedSession;
    if (!session) {
      res.status(401).json({ error: "Accesso richiesto." });
      return;
    }
    if (!allowed.has(session.role)) {
      res.status(403).json({ error: "Permessi insufficienti." });
      return;
    }
    next();
  };
}

/** Enforces the capability matrix independently of route implementation. */
export function requireOrganizationPermission(
  permission: OrganizationPermission,
): RequestHandler {
  return (req, res, next) => {
    const session = req.authenticatedSession;
    if (!session) {
      res.status(401).json({ error: "Accesso richiesto." });
      return;
    }
    if (!ROLE_PERMISSIONS[session.role].has(permission)) {
      res.status(403).json({ error: "Permessi insufficienti." });
      return;
    }
    next();
  };
}

/** Exposes a defensive copy for documentation and deterministic policy tests. */
export function getRolePermissions(
  role: OrganizationRole,
): ReadonlySet<OrganizationPermission> {
  return new Set(ROLE_PERMISSIONS[role]);
}
