import { useEffect, useState, type FormEvent } from "react";
import { api, type OrganizationSettings as OrganizationSettingsData } from "../api";

export function OrganizationSettings() {
  const [settings, setSettings] = useState<OrganizationSettingsData | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const result = await api.organization();
      setSettings(result); setName(result.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile caricare l'organizzazione.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const result = await api.updateOrganization(name);
      setSettings(result); setName(result.name);
      setMessage("Nome organizzazione aggiornato.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile salvare le impostazioni.");
    } finally { setSaving(false); }
  }

  if (loading) return <p className="loading">Caricamento organizzazione…</p>;
  return <section className="card">
    <div className="card-head"><div><h2>Organizzazione</h2><p className="hint">Gestisci i dati identificativi dello spazio di lavoro.</p></div>
      <button type="button" className="button-secondary" onClick={() => void load()}>Aggiorna</button></div>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {settings && <form className="customer-form" onSubmit={(event) => void save(event)}>
      <label>Nome organizzazione<input type="text" required minLength={1} maxLength={150} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Codice organizzazione<input type="text" readOnly value={settings.slug} /></label>
      <label>Creata il<input type="text" readOnly value={new Date(settings.createdAt).toLocaleDateString("it-IT")} /></label>
      <button className="button-secondary" type="submit" disabled={saving || !name.trim() || name.trim() === settings.name}>{saving ? "Salvataggio…" : "Salva modifiche"}</button>
    </form>}
  </section>;
}
