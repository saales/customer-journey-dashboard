import { useEffect, useState } from "react";
import { api, type OrganizationMember } from "../api";

const roles: OrganizationMember["role"][] = ["admin", "editor", "analyst", "viewer"];
const roleLabels: Record<OrganizationMember["role"], string> = {
  admin: "Amministratore",
  editor: "Editor",
  analyst: "Analista",
  viewer: "Visualizzatore",
};

export function MemberManagement() {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [pendingRoles, setPendingRoles] = useState<Record<string, OrganizationMember["role"]>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setMembers(await api.members());
      setPendingRoles({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare i membri.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function update(member: OrganizationMember, changes: { role?: OrganizationMember["role"]; status?: OrganizationMember["status"] }) {
    setSavingId(member.membershipId);
    setError("");
    setMessage("");
    try {
      await api.updateMember(member.membershipId, changes);
      await load();
      setMessage("Permessi del membro aggiornati.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile aggiornare il membro.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <p className="loading">Caricamento dei membri…</p>;

  return <section className="card">
    <div className="card-head">
      <div>
        <h2>Utenti e permessi</h2>
        <p className="hint">Gestione degli accessi appartenenti alla tua organizzazione.</p>
      </div>
      <button type="button" className="button-secondary" onClick={() => void load()}>Aggiorna</button>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {!members.length && !error ? <p className="empty">Nessun membro presente.</p> :
      <div className="table-wrap"><table>
        <thead><tr><th>Utente</th><th>Ruolo</th><th>Stato</th><th>Accesso dal</th><th>Azioni</th></tr></thead>
        <tbody>{members.map(member => <tr key={member.membershipId}>
          <td><strong>{member.fullName || member.email}</strong><br /><span className="hint">{member.email}</span></td>
          <td><select aria-label={`Ruolo di ${member.email}`} value={pendingRoles[member.membershipId] ?? member.role}
            disabled={savingId === member.membershipId}
            onChange={e => setPendingRoles(current => ({...current,[member.membershipId]:e.target.value as OrganizationMember["role"]}))}>
            {roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select></td>
          <td>{member.status === "active" ? "Attivo" : "Sospeso"}</td>
          <td>{new Date(member.joinedAt).toLocaleDateString("it-IT")}</td>
          <td>
            <div className="funnel-stage-actions">
              <button type="button" className="button-secondary"
                disabled={savingId === member.membershipId || (pendingRoles[member.membershipId] ?? member.role) === member.role}
                onClick={() => void update(member,{role:pendingRoles[member.membershipId]})}>Salva ruolo</button>
              <button type="button" className="button-secondary" disabled={savingId === member.membershipId}
                onClick={() => void update(member,{status:member.status === "active" ? "suspended" : "active"})}>
                {member.status === "active" ? "Sospendi" : "Riattiva"}
              </button>
            </div>
          </td>
        </tr>)}</tbody>
      </table></div>}
    <p className="hint">Per sicurezza non puoi modificare il tuo stesso accesso. L'organizzazione deve mantenere almeno un amministratore attivo. L'aggiunta di nuovi membri richiede il flusso di invito, non ancora disponibile.</p>
  </section>;
}
