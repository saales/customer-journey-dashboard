import { useEffect, useState, type FormEvent } from "react";
import { api, type OrganizationMember, type OrganizationInvitation } from "../api";

const roles: OrganizationMember["role"][] = ["admin", "editor", "analyst", "viewer"];
const roleLabels: Record<OrganizationMember["role"], string> = {
  admin: "Amministratore",
  editor: "Editor",
  analyst: "Analista",
  viewer: "Visualizzatore",
};

export function MemberManagement() {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrganizationInvitation["role"]>("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [pendingRoles, setPendingRoles] = useState<Record<string, OrganizationMember["role"]>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const [memberRows, invitationRows] = await Promise.all([api.members(), api.invitations()]);
      setMembers(memberRows);
      setInvitations(invitationRows);
      setPendingRoles({});
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare i membri.");
      return false;
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
      const refreshed = await load();
      setMessage(refreshed
        ? "Permessi del membro aggiornati."
        : "Modifica salvata, ma non è stato possibile aggiornare l'elenco. Usa Aggiorna per verificare i dati.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile aggiornare il membro.");
    } finally {
      setSavingId(null);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingInvite(true);
    setError("");
    setMessage("");
    setInviteUrl("");
    try {
      const created = await api.createInvitation({ email: inviteEmail, role: inviteRole, expiresInDays: 7 });
      setInviteUrl(created.inviteUrl);
      setInviteEmailSent(created.emailSent);
      setInviteEmail("");
      const refreshed = await load();
      setMessage(refreshed
        ? (created.emailSent ? "Invito creato e inviato via email. Il collegamento resta disponibile per la condivisione manuale." : "Invito creato. Email non configurata: condividi il collegamento tramite un canale sicuro.")
        : "Invito creato, ma l'elenco non si è aggiornato. Il collegamento è disponibile qui sopra.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile creare l'invito.");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function revokeInvite(invitation: OrganizationInvitation) {
    setError("");
    setMessage("");
    try {
      await api.revokeInvitation(invitation.id);
      const refreshed = await load();
      setMessage(refreshed
        ? "Invito revocato."
        : "Invito revocato, ma l'elenco non si è aggiornato. Usa Aggiorna per verificare lo stato.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile revocare l'invito.");
    }
  }

  async function copyInviteUrl() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Collegamento copiato.");
    } catch {
      setMessage("Seleziona e copia manualmente il collegamento visualizzato.");
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
    <div className="card" style={{ marginTop: 20 }}>
      <h3>Invita un collaboratore</h3>
      <p className="hint">Crea un collegamento monouso. Se il servizio email è configurato, l'invito viene anche spedito automaticamente.</p>
      <form className="customer-form" onSubmit={(event) => void createInvite(event)}>
        <label>Email<input type="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
        <label>Ruolo<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as OrganizationInvitation["role"])}>
          {roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
        </select></label>
        <button className="button-secondary" type="submit" disabled={creatingInvite || !inviteEmail.trim()}>{creatingInvite ? "Creazione…" : "Crea invito (7 giorni)"}</button>
      </form>
      {inviteUrl && <div className="customer-form">
        <label>Collegamento da condividere<input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></label>
        <button className="button-secondary" type="button" onClick={() => void copyInviteUrl()}>Copia collegamento</button>
      </div>}
      <h3>Inviti recenti</h3>
      {!invitations.length ? <p className="empty">Nessun invito creato.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Email</th><th>Ruolo</th><th>Stato</th><th>Scadenza</th><th>Azioni</th></tr></thead>
        <tbody>{invitations.map(invite => <tr key={invite.id}>
          <td>{invite.email}</td><td>{roleLabels[invite.role]}</td>
          <td>{{pending:"In attesa",accepted:"Accettato",revoked:"Revocato",expired:"Scaduto"}[invite.status]}</td>
          <td>{new Date(invite.expiresAt).toLocaleDateString("it-IT")}</td>
          <td>{invite.status === "pending" && <button className="button-secondary" type="button" onClick={() => void revokeInvite(invite)}>Revoca</button>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
    <p className="hint">Per sicurezza non puoi modificare il tuo stesso accesso. L'organizzazione deve mantenere almeno un amministratore attivo.</p>
  </section>;
}
