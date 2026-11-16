import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Pool } from "pg";
import { createPostgresApp } from "../../src/postgres-app.js";
import { hashPassword } from "../../src/password-hashing.js";
import { applyPostgresMigrations, loadPostgresMigrations } from "../../src/postgres-migrations.js";
import { issuePostgresSession } from "../../src/postgres-session-repository.js";

/**
 * Ambiente di integrazione HTTP end-to-end.
 *
 * Crea un database PostgreSQL TEMPORANEO e un ruolo runtime con nome univoco,
 * applica le migrazioni 001-013 reali, semina due tenant (A e B) con i quattro
 * ruoli e avvia l'app Express reale collegata con il ruolo non privilegiato.
 * Il ruolo e il database vengono rimossi a fine test.
 *
 * SICUREZZA: parte solo se DATABASE_URL punta a un host locale. Non può mai
 * creare/eliminare database su Neon o su altri server remoti, salvo override
 * esplicito e consapevole (TEST_DB_ALLOW_REMOTE=yes-i-know-this-creates-and-drops-databases).
 */

export const ROLES = ["admin", "editor", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export type TenantKey = "A" | "B";

export const ORIGIN = "https://app.example.it";
export const TEST_PASSWORD = "Password-di-test-2026!";
const RATE_LIMIT_SECRET = "http-integration-secret-with-at-least-32-chars";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function integrationDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (LOCAL_HOSTS.has(host)) return url;
    if (process.env.TEST_DB_ALLOW_REMOTE === "yes-i-know-this-creates-and-drops-databases") return url;
  } catch { /* URL non valido: non eseguire */ }
  return null;
}

export interface SeededUser {
  id: string;
  email: string;
  membershipId: string;
  role: Role;
  token: string;
}

export interface SeededTenant {
  id: string;
  slug: string;
  name: string;
  users: Record<Role, SeededUser>;
  customerIds: string[];
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

export interface RequestOptions {
  token?: string | null;
  rawCookie?: string;
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}

export interface HttpTestEnvironment {
  baseUrl: string;
  databaseName: string;
  runtimeRole: string;
  adminPool: Pool;
  runtimePool: Pool;
  tenants: Record<TenantKey, SeededTenant>;
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  /** Crea una sessione reale per un utente seminato (via ruolo runtime). */
  newSession(userId: string, organizationId: string, ttlMs?: number): Promise<string>;
  close(): Promise<void>;
}

function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) parsed.username = user;
  if (password) parsed.password = password;
  return parsed.toString();
}

const INITIAL_STAGES = [
  ["visit", "Visita"], ["lead", "Lead"], ["qualified", "Qualificato"],
  ["opportunity", "Opportunità"], ["customer", "Cliente"],
] as const;

export async function createHttpTestEnvironment(): Promise<HttpTestEnvironment> {
  const adminUrl = integrationDatabaseUrl();
  if (!adminUrl) throw new Error("DATABASE_URL locale non disponibile per i test di integrazione HTTP.");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const databaseName = `http_it_${suffix}`;
  const runtimeRole = `percorso_app_it_${suffix}`;
  const runtimePassword = randomBytes(18).toString("base64url");

  const bootstrapPool = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5_000 });
  await bootstrapPool.query(`CREATE DATABASE "${databaseName}"`);
  await bootstrapPool.query(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}' NOINHERIT`);

  const adminPool = new Pool({ connectionString: withDatabase(adminUrl, databaseName), max: 4, connectionTimeoutMillis: 5_000 });
  const runtimePool = new Pool({
    connectionString: withDatabase(adminUrl, databaseName, runtimeRole, runtimePassword),
    max: 8, connectionTimeoutMillis: 5_000,
  });
  // Il DROP DATABASE ... FORCE finale può raggiungere connessioni idle in chiusura: non è un errore del test.
  let tearingDown = false;
  for (const pool of [bootstrapPool, adminPool, runtimePool]) {
    pool.on("error", (error) => { if (!tearingDown) console.error("Errore pool di test:", error.message); });
  }
  let server: Server | null = null;

  const cleanup = async () => {
    tearingDown = true;
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
    await runtimePool.end().catch(() => undefined);
    await adminPool.end().catch(() => undefined);
    await bootstrapPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
    await bootstrapPool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => undefined);
    await bootstrapPool.end().catch(() => undefined);
  };

  try {
    // Le migrazioni sono quelle reali; si sostituisce solo il nome del ruolo runtime
    // per non collidere con altri test né con il ruolo `percorso_app` del CI.
    const migrations = (await loadPostgresMigrations()).map((migration) => ({
      ...migration, sql: migration.sql.replaceAll("percorso_app", runtimeRole),
    }));
    await applyPostgresMigrations(adminPool, migrations);

    const passwordHash = await hashPassword(TEST_PASSWORD);
    const tenants = {} as Record<TenantKey, SeededTenant>;
    for (const key of ["A", "B"] as const) {
      const slug = `tenant-${key.toLowerCase()}`;
      const org = await adminPool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id::text AS id",
        [`Tenant ${key}`, slug],
      );
      const organizationId = org.rows[0]!.id;
      for (const [index, [id, label]] of INITIAL_STAGES.entries()) {
        await adminPool.query(
          "INSERT INTO funnel_stages (organization_id, id, label, position, is_active, is_system) VALUES ($1, $2, $3, $4, TRUE, TRUE)",
          [organizationId, id, label, index],
        );
      }
      const users = {} as Record<Role, SeededUser>;
      for (const role of ROLES) {
        const email = `${role}.${key.toLowerCase()}@example.test`;
        const user = await adminPool.query<{ id: string }>(
          "INSERT INTO users (email, password_hash, full_name, status, email_verified_at) VALUES ($1, $2, $3, 'active', NOW()) RETURNING id::text AS id",
          [email, passwordHash, `${role} ${key}`],
        );
        const membership = await adminPool.query<{ id: string }>(
          "INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'active') RETURNING id::text AS id",
          [organizationId, user.rows[0]!.id, role],
        );
        const issued = await issuePostgresSession(runtimePool, user.rows[0]!.id, organizationId);
        users[role] = { id: user.rows[0]!.id, email, membershipId: membership.rows[0]!.id, role, token: issued.token };
      }
      const customerIds: string[] = [];
      // `shared-ext-1` esiste in entrambi i tenant: l'unicità è per organizzazione.
      for (const [externalId, channel, createdAt, stages] of [
        [`shared-ext-1`, "Email", "2026-01-10", ["visit", "lead"]],
        [`only-${key.toLowerCase()}-2`, "Social", "2026-01-12", ["visit", "lead", "qualified"]],
      ] as const) {
        const customer = await adminPool.query<{ id: string }>(
          "INSERT INTO customers (organization_id, external_id, channel, created_at) VALUES ($1, $2, $3, $4::date::timestamp AT TIME ZONE 'UTC') RETURNING id::text AS id",
          [organizationId, externalId, channel, createdAt],
        );
        customerIds.push(customer.rows[0]!.id);
        for (const [offset, stage] of stages.entries()) {
          await adminPool.query(
            "INSERT INTO events (organization_id, customer_id, stage_id, occurred_at) VALUES ($1, $2::bigint, $3, ($4::date + $5::int)::timestamp AT TIME ZONE 'UTC')",
            [organizationId, customer.rows[0]!.id, stage, createdAt, offset],
          );
        }
      }
      tenants[key] = { id: organizationId, slug, name: `Tenant ${key}`, users, customerIds };
    }

    const app = createPostgresApp(runtimePool, {
      allowedOrigins: [ORIGIN], rateLimitSecret: RATE_LIMIT_SECRET, production: false,
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const request: HttpTestEnvironment["request"] = async (method, path, options = {}) => {
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      if (options.rawCookie) headers.Cookie = options.rawCookie;
      else if (options.token) headers.Cookie = `percorso_session=${options.token}`;
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers["Content-Type"] = "application/json";
      if (method !== "GET" && options.origin !== null) headers.Origin = options.origin ?? ORIGIN;
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers,
        body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
        redirect: "manual",
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = text ? JSON.parse(text) : null; } catch { /* corpo non JSON (es. CSV) */ }
      return { status: response.status, body: body as never, headers: response.headers, text };
    };

    return {
      baseUrl, databaseName, runtimeRole, adminPool, runtimePool, tenants, request,
      newSession: async (userId, organizationId, ttlMs) =>
        (await issuePostgresSession(runtimePool, userId, organizationId, ttlMs)).token,
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
