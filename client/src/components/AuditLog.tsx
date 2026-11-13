import { useEffect, useState, type FormEvent } from "react";
import { api, type AuditEntry, type AuditPage, type OrganizationMember } from "../api";

const actions = [
  ["customer.created", "Cliente creato"],
  ["customer.updated", "Cliente modificato"],
  ["customer.deleted", "Cliente eliminato"],
  ["funnel.stage.created", "Fase creata"],
  ["funnel.stage.updated", "Fase modificata"],
  ["funnel.stages.reordered", "Fasi riordinate"],
] as const;

function actionLabel(action: string) {
  return actions.find(([key]) => key === action)?.[1] ?? action;
}

export function AuditLog() {
  const [page, setPage] = useState<AuditPage | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [action, setAction] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextPage = currentPage) {
    setLoading(true);
    setError("");
    try {
      const [result, memberRows] = await Promise.all([
        api.audit({ page: nextPage, limit: 25, from: from || undefined, to: to || undefined,
          actorUserId: actorUserId || undefined, action: action || undefined }),
        api.members(),
      ]);
      setPage(result);
      setMembers(memberRows);
      setCurrentPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare il registro attività.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(1); }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(1);
  }

  return <section className="card">
    <div className="card-head">
      <div><h2>Registro attività</h2><p className="hint">Storico delle modifiche effettuate nell'organizzazione. Visibile solo agli amministratori.</p></div>
      <button type="button" className="button-secondary" onClick={() => void load()}>Aggiorna</button>
    </div>
    <form className="customer-form" onSubmit={applyFilters}>
      <label>Dal<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>Al<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
      <label>Utente<select value={actorUserId} onChange={e => setActorUserId(e.target.value)}>
        <option value="">Tutti gli utenti</option>
        {members.map(member => <option key={member.userId} value={member.userId}>{member.fullName || member.email}</option>)}
      </select></label>
      <label>Operazione<select value={action} onChange={e => setAction(e.target.value)}>
        <option value="">Tutte le operazioni</option>
        {actions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <button className="button-secondary" type="submit" disabled={loading || (!!from && !!to && from > to)}>Applica filtri</button>
    </form>
    {error && <div className="error" role="alert">{error}</div>}
    {loading ? <p className="loading">Caricamento registro attività…</p> : !page?.data.length ?
      <p className="empty">Nessuna attività trovata per i filtri selezionati.</p> :
      <div className="table-wrap"><table>
        <thead><tr><th>Data e ora</th><th>Utente</th><th>Operazione</th><th>Risorsa</th><th>Dettagli</th></tr></thead>
        <tbody>{page.data.map((entry: AuditEntry) => <tr key={entry.id}>
          <td>{new Date(entry.createdAt).toLocaleString("it-IT")}</td>
          <td>{entry.actorName || entry.actorEmail || "Utente non disponibile"}</td>
          <td>{actionLabel(entry.action)}</td>
          <td>{entry.resourceType ? `${entry.resourceType} ${entry.resourceId ?? ""}` : "—"}</td>
          <td>{Object.entries(entry.details ?? {}).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "—"}</td>
        </tr>)}</tbody>
      </table></div>}
    {page && page.pagination.totalPages > 1 && <div className="funnel-stage-actions" style={{ marginTop: 16, justifyContent: "space-between" }}>
      <span className="hint">Pagina {page.pagination.page} di {page.pagination.totalPages} · {page.pagination.total} attività</span>
      <div className="funnel-stage-actions">
        <button type="button" className="button-secondary" disabled={loading || currentPage <= 1} onClick={() => void load(currentPage - 1)}>Precedente</button>
        <button type="button" className="button-secondary" disabled={loading || currentPage >= page.pagination.totalPages} onClick={() => void load(currentPage + 1)}>Successiva</button>
      </div>
    </div>}
  </section>;
}
