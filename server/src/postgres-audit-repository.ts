import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";

export interface AuditFilters {
  page: number;
  limit: number;
  from?: string;
  to?: string;
  actorUserId?: string;
  action?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditPage {
  data: AuditEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** Tenant-scoped, read-only audit history. Organization identity must come from the verified session. */
export async function listPostgresAuditLogs(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  filters: AuditFilters,
): Promise<AuditPage> {
  if (!Number.isSafeInteger(filters.page) || filters.page < 1 ||
      !Number.isSafeInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
    throw new Error("Parametri di paginazione audit non validi.");
  }
  const conditions = ["a.organization_id = $1::uuid"];
  const values: unknown[] = [organizationId];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };
  if (filters.from) add("a.created_at >= ?::date", filters.from);
  if (filters.to) add("a.created_at < (?::date + INTERVAL '1 day')", filters.to);
  if (filters.actorUserId) add("a.actor_user_id = ?::uuid", filters.actorUserId);
  if (filters.action) add("a.action = ?", filters.action);
  const where = conditions.join(" AND ");
  const offset = (filters.page - 1) * filters.limit;

  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    const count = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM audit_logs a WHERE ${where}`, values,
    );
    const total = Number(count.rows[0]?.total ?? "0");
    const rows = await client.query<{
      id: string; action: string; resourceType: string | null; resourceId: string | null;
      actorUserId: string | null; actorName: string | null; actorEmail: string | null;
      details: Record<string, unknown>; createdAt: string;
    }>(
      `SELECT a.id::text AS id, a.action, a.resource_type AS "resourceType",
              a.resource_id AS "resourceId", a.actor_user_id::text AS "actorUserId",
              u.full_name AS "actorName", u.email AS "actorEmail",
              a.details, a.created_at AS "createdAt"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, offset],
    );
    return {
      data: rows.rows,
      pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
  });
}
