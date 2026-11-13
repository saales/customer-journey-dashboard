import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;


function assertActorUserId(actorUserId?: string): void {
  if (actorUserId !== undefined && !UUID_RE.test(actorUserId)) {
    throw new Error("Identificativo attore non valido.");
  }
}

async function writeFunnelAudit(
  client: PoolClient,
  organizationId: string,
  actorUserId: string | undefined,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!actorUserId) return;
  await client.query(
    "INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, details) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)",
    [organizationId, actorUserId, action, resourceType, resourceId, JSON.stringify(details)],
  );
}

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
  actorUserId?: string,
): Promise<PostgresFunnelStage[]> {
  assertOrganizationId(organizationId);
  assertActorUserId(actorUserId);
  if (!Array.isArray(orderedStageIds) || orderedStageIds.length > 100) {
    throw new Error("Elenco fasi non valido.");
  }
  if (orderedStageIds.some((id) => typeof id !== "string" || !STAGE_ID_RE.test(id)) ||
      new Set(orderedStageIds).size !== orderedStageIds.length) {
    throw new Error("Identificativi fase non validi o duplicati.");
  }

  if (orderedStageIds[0] !== "visit" || orderedStageIds[orderedStageIds.length - 1] !== "customer") {
    throw new Error("Visita deve essere la prima fase e Cliente l'ultima.");
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
    await writeFunnelAudit(client, organizationId, actorUserId, "funnel.stages.reordered", "funnel", "stages", {
      orderedStageIds,
    });

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
 * Updates a stage within one organization. The advisory lock serializes
 * case-insensitive label checks so concurrent edits cannot create duplicates.
 * Mandatory boundary stages (visit/customer) cannot be deactivated.
 */
export async function updatePostgresFunnelStage(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  stageId: string,
  updates: { label?: unknown; isActive?: unknown },
  actorUserId?: string,
): Promise<PostgresFunnelStage> {
  assertOrganizationId(organizationId);
  assertActorUserId(actorUserId);
  if (typeof stageId !== "string" || !STAGE_ID_RE.test(stageId)) {
    throw new Error("Identificativo fase non valido.");
  }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new Error("Modifiche fase non valide.");
  }

  const keys = Object.keys(updates);
  if (keys.length === 0 || keys.some((key) => key !== "label" && key !== "isActive")) {
    throw new Error("Nessuna modifica valida da applicare.");
  }

  let label: string | undefined;
  let isActive: boolean | undefined;
  if (Object.prototype.hasOwnProperty.call(updates, "label")) {
    if (typeof updates.label !== "string") {
      throw new Error("Il nome della fase deve contenere da 1 a 50 caratteri.");
    }
    label = updates.label.trim();
    if (!label || label.length > 50) {
      throw new Error("Il nome della fase deve contenere da 1 a 50 caratteri.");
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "isActive")) {
    if (typeof updates.isActive !== "boolean") {
      throw new Error("Il campo isActive deve essere booleano.");
    }
    isActive = updates.isActive;
    if (!isActive && (stageId === "visit" || stageId === "customer")) {
      throw new Error("Le fasi Visita e Cliente non possono essere disattivate.");
    }
  }

  return withTenantTransaction(pool, organizationId, async (client: PoolClient) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId]);
    const existing = await client.query<{ id: string }>(
      `SELECT id
       FROM funnel_stages
       WHERE organization_id = $1::uuid AND id = $2
       FOR UPDATE`,
      [organizationId, stageId],
    );
    if (existing.rowCount !== 1) {
      throw new Error("Fase del percorso non trovata.");
    }

    if (label !== undefined) {
      const duplicate = await client.query<{ id: string }>(
        `SELECT id
         FROM funnel_stages
         WHERE organization_id = $1::uuid
           AND LOWER(label) = LOWER($2)
           AND id <> $3
         LIMIT 1`,
        [organizationId, label, stageId],
      );
      if (duplicate.rowCount) {
        throw new Error("Esiste già una fase con questo nome.");
      }
    }

    const result = await client.query<FunnelStageRow>(
      `UPDATE funnel_stages
       SET label = COALESCE($3, label),
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
       WHERE organization_id = $1::uuid AND id = $2
       RETURNING id, label, position,
                 is_active AS "isActive", is_system AS "isSystem"`,
      [organizationId, stageId, label ?? null, isActive ?? null],
    );
    if (!result.rows[0]) {
      throw new Error("Fase del percorso non trovata.");
    }
    await writeFunnelAudit(client, organizationId, actorUserId, "funnel.stage.updated", "funnel_stage", stageId, {
      label: result.rows[0].label,
      isActive: result.rows[0].isActive,
    });
    return result.rows[0];
  });
}



/** Crea una fase personalizzata con ID stabile e posizione finale nel tenant. */
export async function createPostgresFunnelStage(
  pool: Pick<Pool, "connect">,
  organizationId: string,
  rawLabel: string,
  actorUserId?: string,
): Promise<PostgresFunnelStage> {
  assertOrganizationId(organizationId);
  assertActorUserId(actorUserId);
  if (typeof rawLabel !== "string" || !rawLabel.trim() || rawLabel.trim().length > 50) {
    throw new Error("Il nome della fase deve contenere da 1 a 50 caratteri.");
  }
  const label = rawLabel.trim();
  return withTenantTransaction(pool, organizationId, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId]);
    const duplicate = await client.query<{ id: string }>(
      "SELECT id FROM funnel_stages WHERE organization_id=$1::uuid AND LOWER(label)=LOWER($2) LIMIT 1",
      [organizationId, label],
    );
    if (duplicate.rowCount) throw new Error("Esiste già una fase con questo nome.");
    const current = await client.query<{ id: string; position: number }>(
      "SELECT id, position FROM funnel_stages WHERE organization_id=$1::uuid ORDER BY position ASC FOR UPDATE",
      [organizationId],
    );
    const currentIds = current.rows.map((row) => row.id);
    if (currentIds[0] !== "visit" || currentIds[currentIds.length - 1] !== "customer") {
      throw new Error("Configurazione delle fasi non valida: Visita deve essere prima e Cliente ultima.");
    }
    if (current.rows.length >= 100) throw new Error("Il percorso non può contenere più di 100 fasi.");
    const customerPosition = currentIds.length - 1;
    const maxPosition = Math.max(...current.rows.map((row) => row.position));
    const offset = maxPosition + current.rows.length + 2;
    if (!Number.isSafeInteger(offset) || offset > 2_000_000_000) {
      throw new Error("Posizioni funnel fuori dall'intervallo consentito.");
    }
    await client.query(
      "UPDATE funnel_stages SET position=position+$2,updated_at=NOW() WHERE organization_id=$1::uuid",
      [organizationId, offset],
    );
    for (let index = 0; index < current.rows.length; index += 1) {
      const position = index < customerPosition ? index : index + 1;
      await client.query(
        "UPDATE funnel_stages SET position=$3,updated_at=NOW() WHERE organization_id=$1::uuid AND id=$2",
        [organizationId, current.rows[index].id, position],
      );
    }
    const id = `custom_${randomUUID().replace(/-/g, "")}`;
    const inserted = await client.query<FunnelStageRow>(
      `INSERT INTO funnel_stages (organization_id,id,label,position,is_active,is_system)
       VALUES ($1::uuid,$2,$3,$4,TRUE,FALSE)
       RETURNING id,label,position,is_active AS "isActive",is_system AS "isSystem"`,
      [organizationId,id,label,customerPosition],
    );
    if (!inserted.rows[0]) throw new Error("Creazione fase non riuscita.");
    await writeFunnelAudit(client, organizationId, actorUserId, "funnel.stage.created", "funnel_stage", id, {
      label,
      position: customerPosition,
    });
    return inserted.rows[0];
  });
}
