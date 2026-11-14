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
  pool: Pick<Pool, "connect">, organizationId: string, actorUserId: string,
): Promise<{ csv: string; rowCount: number }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorUserId)) {
    throw new Error("Identificativo attore non valido.");
  }
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
    await client.query(
      `INSERT INTO audit_logs
       (organization_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1::uuid, $2::uuid, 'data.exported', 'customer_export', NULL, $3::jsonb)`,
      [organizationId, actorUserId, JSON.stringify({ rowCount: result.rows.length, format: "csv" })],
    );
    const header = ["ID cliente", "Identificativo esterno", "Canale", "Prima visita", "Fase", "Data evento"];
    const lines = [header.map(csvCell).join(";")];
    for (const row of result.rows) {
      lines.push([row.id, row.externalId, row.channel, row.createdAt, row.stage, row.occurredAt].map(csvCell).join(";"));
    }
    return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", rowCount: result.rows.length };
  });
}


export interface PostgresOrganizationExport {
  schemaVersion: 1;
  generatedAt: string;
  organization: { id: string; name: string; slug: string; createdAt: string };
  funnelStages: { id: string; label: string; position: number; isActive: boolean; isSystem: boolean }[];
  customers: {
    id: string; externalId: string; channel: string; createdAt: string;
    events: { stage: string; occurredAt: string }[];
  }[];
  importBatches: {
    id: string; fileName: string; fingerprint: string; customerCount: number;
    rowCount: number; importedBy: string | null; importedAt: string;
  }[];
}

function assertExportLimit(count: number, resource: string): void {
  if (count > MAX_EXPORT_ROWS) {
    throw new PostgresExportError(413, `Esportazione troppo ampia (${resource}): suddividere i dati prima di riprovare.`);
  }
}

/** Complete, secret-free organization data portability export (JSON). */
export async function exportPostgresOrganizationJson(
  pool: Pick<Pool, "connect">, organizationId: string, actorUserId: string,
): Promise<PostgresOrganizationExport> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorUserId)) {
    throw new Error("Identificativo attore non valido.");
  }
  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    const organizationResult = await client.query<{ id: string; name: string; slug: string; createdAt: string }>(
      `SELECT id::text AS id, name, slug,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
       FROM organizations WHERE id = $1::uuid`,
      [organizationId],
    );
    const organization = organizationResult.rows[0];
    if (!organization) throw new PostgresExportError(404, "Organizzazione non trovata.");

    const stagesResult = await client.query<PostgresOrganizationExport["funnelStages"][number]>(
      `SELECT id, label, position, is_active AS "isActive", is_system AS "isSystem"
       FROM funnel_stages WHERE organization_id = $1::uuid ORDER BY position ASC`,
      [organizationId],
    );
    const customerResult = await client.query<{
      id: string; externalId: string; channel: string; createdAt: string;
      stage: string | null; occurredAt: string | null;
    }>(
      `SELECT c.id::text AS id, c.external_id AS "externalId", c.channel,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              e.stage_id AS stage,
              CASE WHEN e.id IS NULL THEN NULL ELSE
                to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS "occurredAt"
       FROM customers c
       LEFT JOIN events e ON e.organization_id = c.organization_id AND e.customer_id = c.id
       WHERE c.organization_id = $1::uuid
       ORDER BY c.id ASC, e.occurred_at ASC NULLS LAST, e.id ASC
       LIMIT $2`,
      [organizationId, MAX_EXPORT_ROWS + 1],
    );
    const importResult = await client.query<PostgresOrganizationExport["importBatches"][number]>(
      `SELECT id::text AS id, file_name AS "fileName", fingerprint,
              customer_count AS "customerCount", row_count AS "rowCount",
              imported_by::text AS "importedBy",
              to_char(imported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "importedAt"
       FROM import_batches WHERE organization_id = $1::uuid
       ORDER BY imported_at ASC, id ASC LIMIT $2`,
      [organizationId, MAX_EXPORT_ROWS + 1],
    );
    assertExportLimit(stagesResult.rows.length, "fasi");
    assertExportLimit(customerResult.rows.length, "clienti ed eventi");
    assertExportLimit(importResult.rows.length, "importazioni");

    const customers = new Map<string, PostgresOrganizationExport["customers"][number]>();
    for (const row of customerResult.rows) {
      let customer = customers.get(row.id);
      if (!customer) {
        customer = { id: row.id, externalId: row.externalId, channel: row.channel, createdAt: row.createdAt, events: [] };
        customers.set(row.id, customer);
      }
      if (row.stage !== null && row.occurredAt !== null) customer.events.push({ stage: row.stage, occurredAt: row.occurredAt });
    }
    const exported: PostgresOrganizationExport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      organization,
      funnelStages: stagesResult.rows,
      customers: [...customers.values()],
      importBatches: importResult.rows,
    };
    await client.query(
      `INSERT INTO audit_logs
       (organization_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1::uuid, $2::uuid, 'data.exported', 'organization_export', NULL, $3::jsonb)`,
      [organizationId, actorUserId, JSON.stringify({
        format: "json", customers: exported.customers.length,
        funnelStages: exported.funnelStages.length, importBatches: exported.importBatches.length,
      })],
    );
    return exported;
  });
}
