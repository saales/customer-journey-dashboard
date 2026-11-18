import type { Pool } from "pg";
import { withTenantTransaction } from "./tenant-transaction.js";

export interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export class OrganizationSettingsError extends Error {
  constructor(public readonly status: 400 | 404, message: string) { super(message); }
}

export async function getPostgresOrganizationSettings(
  pool: Pick<Pool, "connect">, organizationId: string,
): Promise<OrganizationSettings> {
  return withTenantTransaction(pool, organizationId, async client => {
    const result = await client.query<OrganizationSettings>(
      `SELECT id::text AS id, name, slug,
              to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
       FROM organizations WHERE id=$1::uuid LIMIT 1`, [organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new OrganizationSettingsError(404, "Organizzazione non trovata.");
    return row;
  });
}

export async function updatePostgresOrganizationName(
  pool: Pick<Pool, "connect">, organizationId: string, actorUserId: string, input: unknown,
): Promise<OrganizationSettings> {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 150) {
    throw new OrganizationSettingsError(400, "Il nome dell'organizzazione deve contenere da 1 a 150 caratteri.");
  }
  const name = input.trim();
  return withTenantTransaction(pool, organizationId, async client => {
    const updated = await client.query(
      `UPDATE organizations SET name=$2, updated_at=NOW()
       WHERE id=$1::uuid RETURNING id::text AS id, name, slug,
       to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`,
      [organizationId, name],
    );
    const row = updated.rows[0] as OrganizationSettings | undefined;
    if (!row) throw new OrganizationSettingsError(404, "Organizzazione non trovata.");
    await client.query(
      `INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,details)
       VALUES($1::uuid,$2::uuid,'organization.updated','organization',$1::text,jsonb_build_object('name',$3::text))`,
      [organizationId, actorUserId, name],
    );
    return row;
  });
}
