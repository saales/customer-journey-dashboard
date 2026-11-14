import { useEffect, useState, type FormEvent } from "react";
import { api, type AccountProfile, type AccountSession } from "../api";

export function AccountSettings() {
  const [profile,setProfile]=useState<AccountProfile|null>(null);
  const [fullName,setFullName]=useState("");
  const [currentPassword,setCurrentPassword]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [loading,setLoading]=useState(true);
  const [sessions,setSessions]=useState<AccountSession[]>([]);
  const [revokingSession,setRevokingSession]=useState("");
  const [savingProfile,setSavingProfile]=useState(false);
  const [savingPassword,setSavingPassword]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function load(){
    setLoading(true);setError("");
    try{const [result,sessionResult]=await Promise.all([api.account(),api.accountSessions()]);setProfile(result);setFullName(result.fullName);setSessions(sessionResult.sessions);}
    catch(cause){setError(cause instanceof Error?cause.message:"Impossibile caricare il profilo.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  async function saveProfile(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSavingProfile(true);setError("");setMessage("");
    try{const result=await api.updateAccount(fullName);setProfile(result);setFullName(result.fullName);setMessage("Profilo aggiornato.");}
    catch(cause){setError(cause instanceof Error?cause.message:"Impossibile aggiornare il profilo.");}
    finally{setSavingProfile(false);}
  }

  async function savePassword(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");setMessage("");
    if(newPassword!==confirmPassword){setError("Le nuove password non coincidono.");return;}
    setSavingPassword(true);
    try{
      await api.changePassword(currentPassword,newPassword);
      setCurrentPassword("");setNewPassword("");setConfirmPassword("");
      window.location.assign("/");
    }catch(cause){setError(cause instanceof Error?cause.message:"Impossibile cambiare la password.");}
    finally{setSavingPassword(false);}
  }

  if(loading)return <p className="loading">Caricamento profilo…</p>;
  return <section className="card">
    <div className="card-head"><div><h2>Il tuo account</h2><p className="hint">Gestisci i dati personali e le credenziali di accesso.</p></div>
      <button type="button" className="button-secondary" onClick={()=>void load()}>Aggiorna</button></div>
    {error&&<div className="error" role="alert">{error}</div>}
    {message&&<div className="notice" role="status">{message}</div>}
    {profile&&<>
      <form className="customer-form" onSubmit={event=>void saveProfile(event)}>
        <label>Nome e cognome<input type="text" required minLength={1} maxLength={150} value={fullName} onChange={event=>setFullName(event.target.value)}/></label>
        <label>Email<input type="email" readOnly value={profile.email}/></label>
        <label>Ruolo<input type="text" readOnly value={profile.role}/></label>
        <button className="button-secondary" type="submit" disabled={savingProfile||!fullName.trim()||fullName.trim()===profile.fullName}>{savingProfile?"Salvataggio…":"Salva profilo"}</button>
      </form>
      <div className="divider" />
      <h3>Sessioni attive</h3>
      <p className="hint">Controlla gli accessi al tuo account e revoca i dispositivi che non riconosci. La sessione corrente non può essere revocata da qui.</p>
      {sessions.length===0?<p className="hint">Nessuna sessione attiva trovata.</p>:<div className="member-list">
        {sessions.map(session=><div className="member-row" key={session.id}>
          <div className="member-info">
            <strong>{session.current?"Questo dispositivo":"Sessione attiva"}</strong>
            <span className="hint">Ultimo utilizzo: {new Date(session.lastUsedAt).toLocaleString("it-IT")}</span>
            <span className="hint">Accesso: {new Date(session.createdAt).toLocaleString("it-IT")}</span>
          </div>
          {session.current?<span className="status-badge">Corrente</span>:<button type="button" className="button-secondary" disabled={revokingSession===session.id} onClick={async()=>{
            if(!window.confirm("Revocare questa sessione? Il dispositivo dovrà accedere nuovamente."))return;
            setRevokingSession(session.id);setError("");setMessage("");
            try{await api.revokeAccountSession(session.id);setSessions(current=>current.filter(item=>item.id!==session.id));setMessage("Sessione revocata.");}
            catch(cause){setError(cause instanceof Error?cause.message:"Impossibile revocare la sessione.");}
            finally{setRevokingSession("");}
          }}>{revokingSession===session.id?"Revoca…":"Revoca"}</button>}
        </div>)}
      </div>}
      <div className="divider" />
      <h3>Cambia password</h3>
      <p className="hint">Dopo il cambio verranno revocate tutte le sessioni e dovrai accedere nuovamente.</p>
      <form className="customer-form" onSubmit={event=>void savePassword(event)}>
        <label>Password attuale<input type="password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></label>
        <label>Nuova password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={newPassword} onChange={event=>setNewPassword(event.target.value)}/></label>
        <label>Conferma nuova password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)}/></label>
        <button className="button-secondary" type="submit" disabled={savingPassword||!currentPassword||newPassword.length<12||!confirmPassword}>{savingPassword?"Aggiornamento…":"Cambia password"}</button>
      </form>
    </>}
  </section>;
}
