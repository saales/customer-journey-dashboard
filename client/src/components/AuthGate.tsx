import { useEffect, useState, type FormEvent, type ReactNode } from "react";

type AuthState = "loading" | "authenticated" | "anonymous" | "error" | "demo";
interface AuthSession { userId: string; organizationId: string; role: "admin" | "editor" | "analyst" | "viewer"; }
interface AuthGateProps { children: (logout: () => Promise<void>, demoMode: boolean, role: AuthSession["role"] | null) => ReactNode; }

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
      if (result.response.status === 404 && import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_MODE === "true") { setRole(null); setState("demo"); return; }
      throw new Error("Servizio di accesso non disponibile. Verificare il runtime PostgreSQL.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile verificare la sessione.");
      setState("error");
    }
  }

  useEffect(() => { void checkSession(); }, []);

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

  if (state === "loading") return <main className="auth-screen"><p className="loading">Verifica dell'accesso in corso…</p></main>;
  if (state === "authenticated") return <>{children(logout, false, role)}</>;
  if (state === "demo") return <>{children(async () => undefined, true, null)}</>;

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
        <p className="auth-footnote">La sessione è protetta da un cookie non accessibile agli script del browser.</p>
      </section>
    </main>
  );
}
