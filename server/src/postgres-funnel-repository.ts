import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export interface PostgresFunnelStage {
  id: string;
  label: string;
  position: number;
  isActive: boolean;
  isSystem: boolean;
}

interface FunnelStageRow {
  id: string;
  label: string;
  position: number;
  isActive: boolean;
  isSystem: boolean;
}

function assertOrganizationId(organizationId: string): void {
  if (!UUID_RE.test(organizationId)) {
    throw new Error("Identificativo organizzazione non valido.");
  }
}

/** Lists funnel stages in configured order inside the authenticated tenant. */
export async function listPostgresFunnelStages(
  pool: Pick<Pool, "connect">,
  organizationId: string,
): Promise<PostgresFunnelStage[]> {
  assertOrganizationId(organizationId);
  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    const result = await client.query<FunnelStageRow>(
      `SELECT id, label, position, is_active AS "isActive", is_system AS "isSystem"
       FROM funnel_stages
       WHERE organization_id = $1::uuid
       ORDER BY position ASC, id ASC`,
      [organizationId],
    );
    return result.rows;
  });
}

/**
 * Reorders the complete stage set atomically. Requiring every stage (including
 * inactive ones) avoids accidental deletion or ambiguous position semantics.
 * A two-phase offset avoids transient collisions with the immediate UNIQUE
 * (organization_id, position) constraint.
 */
export async function reorderPostgresFunnelStages(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  orderedStageIds: string[],
): Promise<PostgresFunnelStage[]> {
  assertOrganizationId(organizationId);
  if (!Array.isArray(orderedStageIds) || orderedStageIds.length > 100) {
    throw new Error("Elenco fasi non valido.");
  }
  if (orderedStageIds.some((id) => typeof id !== "string" || !STAGE_ID_RE.test(id)) ||
      new Set(orderedStageIds).size !== orderedStageIds.length) {
    throw new Error("Identificativi fase non validi o duplicati.");
  }

  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId]);
    const current = await client.query<{ id: string; position: number }>(
      `SELECT id, position
       FROM funnel_stages
       WHERE organization_id = $1::uuid
       ORDER BY position ASC
       FOR UPDATE`,
      [organizationId],
    );
    const currentIds = current.rows.map((stage) => stage.id);
    if (currentIds.length !== orderedStageIds.length ||
        currentIds.some((id) => !orderedStageIds.includes(id))) {
      throw new Error("L'ordinamento deve includere tutte le fasi dell'organizzazione.");
    }
    if (orderedStageIds.length === 0) return [];

    const maxPosition = Math.max(...current.rows.map((stage) => stage.position));
    const offset = maxPosition + orderedStageIds.length + 1;
    if (!Number.isSafeInteger(offset) || offset > 2_000_000_000) {
      throw new Error("Posizioni funnel fuori dall'intervallo consentito.");
    }

    await client.query(
      "UPDATE funnel_stages SET position = position + $2 WHERE organization_id = $1::uuid",
      [organizationId, offset],
    );
    for (let position = 0; position < orderedStageIds.length; position += 1) {
      await client.query(
        `UPDATE funnel_stages
         SET position = $3, updated_at = NOW()
         WHERE organization_id = $1::uuid AND id = $2`,
        [organizationId, orderedStageIds[position], position],
      );
    }

    const result = await client.query<FunnelStageRow>(
      `SELECT id, label, position, is_active AS "isActive", is_system AS "isSystem"
       FROM funnel_stages
       WHERE organization_id = $1::uuid
       ORDER BY position ASC, id ASC`,
      [organizationId],
    );
    return result.rows;
  });
}
