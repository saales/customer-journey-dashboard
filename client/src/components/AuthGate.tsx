import { useEffect, useState, type FormEvent, type ReactNode } from "react";

type AuthState = "loading" | "authenticated" | "anonymous" | "error";
interface AuthSession { userId: string; organizationId: string; role: "admin" | "editor" | "analyst" | "viewer"; }
interface AuthGateProps { children: (logout: () => Promise<void>, role: AuthSession["role"] | null) => ReactNode; }

async function readSession(): Promise<{ response: Response; session?: AuthSession }> {
  const response = await fetch("/api/auth/session", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return { response };
  return { response, session: await response.json() as AuthSession };
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AuthState>("loading");
  const [role, setRole] = useState<AuthSession["role"] | null>(null);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get("reset") ?? "");
  const [resetEmail, setResetEmail] = useState("");
  const [resetOrganization, setResetOrganization] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordConfirm, setInvitePasswordConfirm] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function checkSession() {
    setState("loading"); setError("");
    try {
      const result = await readSession();
      if (result.response.ok && result.session) { setRole(result.session.role); setState("authenticated"); return; }
      if (result.response.status === 401) { setRole(null); setState("anonymous"); return; }
      throw new Error("Servizio di accesso non disponibile. Verificare il runtime PostgreSQL.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile verificare la sessione.");
      setState("error");
    }
  }

  useEffect(() => { if (!inviteToken && !resetToken) void checkSession(); }, [inviteToken, resetToken]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password, organizationSlug }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Accesso non riuscito.");
      const session = await readSession();
      if (!session.response.ok) throw new Error("Accesso effettuato, ma la sessione non è verificabile.");
      setPassword(""); setRole(session.session?.role ?? null); setState("authenticated");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accesso non riuscito.");
    } finally { setSubmitting(false); }
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invitePassword !== invitePasswordConfirm) {
      setError("Le password inserite non coincidono.");
      return;
    }
    setInviteSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: inviteToken, fullName: inviteName, password: invitePassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Accettazione dell'invito non riuscita.");
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setInvitePassword("");
      setInvitePasswordConfirm("");
      setInviteToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accettazione dell'invito non riuscita.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setResetSubmitting(true); setError(""); setResetRequested(false);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: resetEmail, organizationSlug: resetOrganization }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Richiesta non riuscita.");
      setResetRequested(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Richiesta non riuscita."); }
    finally { setResetSubmitting(false); }
  }

  async function completePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetPassword !== resetPasswordConfirm) { setError("Le password inserite non coincidono."); return; }
    setResetSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/password-reset/complete", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: resetToken, password: resetPassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Reimpostazione non riuscita.");
      const url = new URL(window.location.href); url.searchParams.delete("reset");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      setResetToken(""); setResetPassword(""); setResetPasswordConfirm(""); setError(""); setState("anonymous");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reimpostazione non riuscita."); }
    finally { setResetSubmitting(false); }
  }
  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Uscita non riuscita.");
      }
      setPassword(""); setRole(null); setState("anonymous");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Uscita non riuscita.");
      setState("error");
    }
  }

  if (inviteToken) return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark">PC</div>
          <div><strong>Percorso Cliente</strong><span>Invito organizzazione</span></div>
        </div>
        <h1>Completa l'accesso</h1>
        <p className="auth-intro">Imposta i tuoi dati per entrare nell'organizzazione. Se possiedi già un account, inserisci la password attuale.</p>
        <form onSubmit={(event) => void acceptInvitation(event)} className="auth-form">
          <label>Nome e cognome<input type="text" autoComplete="name" required maxLength={150} value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} /></label>
          <label>Conferma password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={invitePasswordConfirm} onChange={(event) => setInvitePasswordConfirm(event.target.value)} /></label>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={inviteSubmitting}>{inviteSubmitting ? "Verifica invito…" : "Accetta invito"}</button>
        </form>
        <p className="auth-footnote">Il collegamento è monouso e ha una scadenza. Non inoltrarlo a persone non autorizzate.</p>
      </section>
    </main>
  );

  if (resetToken) return (
    <main className="auth-screen"><section className="auth-card">
      <div className="auth-brand"><div className="auth-brand-mark">PC</div><div><strong>Percorso Cliente</strong><span>Recupero account</span></div></div>
      <h1>Imposta una nuova password</h1>
      <form onSubmit={(event) => void completePasswordReset(event)} className="auth-form">
        <label>Nuova password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
        <label>Conferma password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={resetPasswordConfirm} onChange={(event) => setResetPasswordConfirm(event.target.value)} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={resetSubmitting}>{resetSubmitting ? "Aggiornamento…" : "Aggiorna password"}</button>
      </form>
      <p className="auth-footnote">Il collegamento è monouso e scade dopo 30 minuti. Dopo il cambio password dovrai accedere nuovamente.</p>
    </section></main>
  );

  if (state === "loading") return <main className="auth-screen"><p className="loading">Verifica dell'accesso in corso…</p></main>;
  if (state === "authenticated") return <>{children(logout, role)}</>;

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark">PC</div>
          <div><strong>Percorso Cliente</strong><span>Area riservata</span></div>
        </div>
        <h1>Accedi al tuo spazio di lavoro</h1>
        <p className="auth-intro">Inserisci le credenziali e il codice della tua organizzazione.</p>
        {state === "error" ? (
          <>
            <div className="error" role="alert">{error}</div>
            <button className="auth-submit" type="button" onClick={() => void checkSession()}>Riprova</button>
          </>
        ) : (
          <form onSubmit={(event) => void handleLogin(event)} className="auth-form">
            <label>Email<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Codice organizzazione<input type="text" autoComplete="organization" required maxLength={100}
              pattern="[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?" value={organizationSlug}
              onChange={(event) => setOrganizationSlug(event.target.value.toLowerCase())} /></label>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Accesso in corso…" : "Accedi"}</button>
          </form>
        )}
        <details className="auth-recovery">
          <summary>Hai dimenticato la password?</summary>
          <form onSubmit={(event) => void requestPasswordReset(event)} className="auth-form">
            <label>Email<input type="email" autoComplete="email" required maxLength={254} value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} /></label>
            <label>Codice organizzazione<input type="text" required maxLength={100} pattern="[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?" value={resetOrganization} onChange={(event) => setResetOrganization(event.target.value.toLowerCase())} /></label>
            {resetRequested && <div className="notice" role="status">Se l'account esiste e l'invio email è configurato, riceverai le istruzioni.</div>}
            <button className="button-secondary" type="submit" disabled={resetSubmitting}>{resetSubmitting ? "Invio…" : "Invia istruzioni"}</button>
          </form>
        </details>
        <p className="auth-footnote">La sessione è protetta da un cookie non accessibile agli script del browser.</p>
      </section>
    </main>
  );
}
