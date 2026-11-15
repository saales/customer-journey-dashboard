import type { Pool } from "pg";

export interface TenantDeletionPlan {
  database: string;
  organizationId: string;
  organizationSlug: string;
  counts: Record<string, number>;
  orphanUserCandidates: number;
}
export interface TenantDeletionReceipt extends TenantDeletionPlan {
  executedAtUtc: string;
  deletedUsers: number;
  keptUsers: number;
}

const COUNT_SQL = `
  SELECT (SELECT COUNT(*) FROM customers WHERE organization_id=$1)::int AS customers,
         (SELECT COUNT(*) FROM events WHERE organization_id=$1)::int AS events,
         (SELECT COUNT(*) FROM funnel_stages WHERE organization_id=$1)::int AS funnel_stages,
         (SELECT COUNT(*) FROM import_batches WHERE organization_id=$1)::int AS import_batches,
         (SELECT COUNT(*) FROM memberships WHERE organization_id=$1)::int AS memberships,
         (SELECT COUNT(*) FROM invitations WHERE organization_id=$1)::int AS invitations,
         (SELECT COUNT(*) FROM sessions WHERE organization_id=$1)::int AS sessions,
         (SELECT COUNT(*) FROM audit_logs WHERE organization_id=$1)::int AS audit_logs`;
const ORPHAN_SQL = `
  SELECT COUNT(*)::int AS n FROM users u
  WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id=$1)
    AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id<>$1)`;

async function loadPlan(
  client: { query: Pool["query"] }, slug: string, expectedDatabase: string, lockOrganization = false,
): Promise<TenantDeletionPlan> {
  if (!slug.trim() || !expectedDatabase.trim()) throw new Error("Slug e database atteso sono obbligatori.");
  const db = await client.query<{ name: string }>("SELECT current_database() AS name");
  if (db.rows[0]?.name !== expectedDatabase) {
    throw new Error(`Database collegato "${db.rows[0]?.name ?? "sconosciuto"}" diverso da quello confermato "${expectedDatabase}". Nessuna operazione eseguita.`);
  }
  // Il lock impedisce nuove FK verso il tenant mentre si contano e cancellano i suoi dati.
  const org = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM organizations WHERE slug=$1 ${lockOrganization ? "FOR UPDATE" : ""}`, [slug],
  );
  if (!org.rows[0]) throw new Error(`Organizzazione "${slug}" non trovata.`);
  const id = org.rows[0].id;
  const counts = (await client.query(COUNT_SQL, [id])).rows[0] as Record<string, number>;
  const orphans = (await client.query<{ n: number }>(ORPHAN_SQL, [id])).rows[0]!.n;
  return { database: expectedDatabase, organizationId: id, organizationSlug: slug, counts, orphanUserCandidates: orphans };
}

/** Anteprima in sola lettura: non modifica alcun dato. */
export async function planTenantDeletion(
  pool: Pick<Pool, "connect">, slug: string, expectedDatabase: string,
): Promise<TenantDeletionPlan> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try { return await loadPlan(client, slug, expectedDatabase); }
    finally { await client.query("ROLLBACK"); }
  } finally { client.release(); }
}

/**
 * Cancellazione atomica con ruolo proprietario. Il tenant viene bloccato prima del conteggio;
 * gli utenti candidati vengono bloccati prima di valutarne l'eventuale membership condivisa.
 */
export async function deleteTenant(
  pool: Pick<Pool, "connect">, slug: string, options: { expectedDatabase: string; confirmSlug: string },
): Promise<TenantDeletionReceipt> {
  if (options.confirmSlug !== slug) throw new Error("La conferma dello slug non coincide: nessuna operazione eseguita.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const plan = await loadPlan(client, slug, options.expectedDatabase, true);
    const tenantUsers = await client.query<{ count: number }>(
      "SELECT COUNT(DISTINCT user_id)::int AS count FROM memberships WHERE organization_id=$1",
      [plan.organizationId],
    );
    const candidates = await client.query<{ id: string }>(
      `SELECT u.id::text AS id FROM users u
       WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id=$1)
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id<>$1)
       FOR UPDATE OF u`, [plan.organizationId],
    );
    await client.query("DELETE FROM events WHERE organization_id=$1", [plan.organizationId]);
    await client.query("DELETE FROM organizations WHERE id=$1", [plan.organizationId]);
    let deleted = 0;
    for (const user of candidates.rows) {
      await client.query("SAVEPOINT remove_user");
      try {
        await client.query("DELETE FROM users WHERE id=$1::uuid", [user.id]);
        await client.query("RELEASE SAVEPOINT remove_user");
        deleted += 1;
      } catch (error) {
        if ((error as { code?: string }).code !== "23503") throw error;
        await client.query("ROLLBACK TO SAVEPOINT remove_user");
      }
    }
    await client.query("COMMIT");
    return { ...plan, executedAtUtc: new Date().toISOString(), deletedUsers: deleted, keptUsers: tenantUsers.rows[0]!.count - deleted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
