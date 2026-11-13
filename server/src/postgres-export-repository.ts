import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";

const MAX_EXPORT_ROWS = 100_000;
export class PostgresExportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export async function exportPostgresCustomersCsv(
  pool: Pick<Pool, "connect">, organizationId: string,
): Promise<{ csv: string; rowCount: number }> {
  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    const result = await client.query<{
      id: string; externalId: string; channel: string; createdAt: string;
      stage: string | null; occurredAt: string | null;
    }>(
      `SELECT c.id::text AS id, c.external_id AS "externalId", c.channel,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "createdAt",
              e.stage_id AS stage,
              CASE WHEN e.id IS NULL THEN NULL ELSE
                to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS "occurredAt"
       FROM customers c
       LEFT JOIN events e ON e.organization_id = c.organization_id AND e.customer_id = c.id
       WHERE c.organization_id = $1::uuid
       ORDER BY c.id DESC, e.occurred_at ASC NULLS LAST, e.id ASC
       LIMIT $2`,
      [organizationId, MAX_EXPORT_ROWS + 1],
    );
    if (result.rows.length > MAX_EXPORT_ROWS) {
      throw new PostgresExportError(413, "Esportazione troppo ampia: restringere i dati o suddividerli prima di riprovare.");
    }
    const header = ["ID cliente", "Identificativo esterno", "Canale", "Prima visita", "Fase", "Data evento"];
    const lines = [header.map(csvCell).join(";")];
    for (const row of result.rows) {
      lines.push([row.id, row.externalId, row.channel, row.createdAt, row.stage, row.occurredAt].map(csvCell).join(";"));
    }
    return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", rowCount: result.rows.length };
  });
}
