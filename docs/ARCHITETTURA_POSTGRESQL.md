# Architettura — Percorso Cliente

## Scopo e runtime

Percorso Cliente è una piattaforma web B2B multi-organizzazione per analizzare il percorso cliente, il funnel e le conversioni. PostgreSQL è l'unico database applicativo.

- **Frontend:** React, TypeScript, Vite e Recharts.
- **Backend:** Node.js, Express e TypeScript; entrypoint `server/src/postgres-server.ts`.
- **Persistenza:** PostgreSQL tramite `pg`.
- **Test:** Vitest, Testing Library, PostgreSQL 16 temporaneo e Playwright/Chromium nella CI.
- **Runtime:** `npm run dev` per sviluppo; `npm start` per il server compilato.

## Flussi principali

1. L'utente accede con slug dell'organizzazione, email e password.
2. Il server verifica le credenziali e la membership attiva, quindi crea una sessione opaca.
3. Il cookie di sessione è HttpOnly e SameSite=Strict; in produzione usa il prefisso host-only `__Host-` e l'attributo Secure.
4. Le API risolvono la sessione e ricavano da essa organizzazione, utente e ruolo. Il browser non può scegliere l'organizzazione attiva tramite un parametro arbitrario.
5. I repository eseguono query tenant-scoped in transazioni PostgreSQL; le tabelle operative applicano Row Level Security.
6. Le operazioni amministrative e sui dati scrivono gli eventi previsti nell'audit log.

## Moduli funzionali

- Dashboard, KPI, analisi temporali, canali, segmentazione e confronti.
- Gestione clienti, eventi e fasi del funnel.
- Importazione dati e validazione server-side.
- Esportazione CSV clienti ed export JSON dell'organizzazione, con permessi dedicati.
- Autenticazione, sessioni, revoca, cambio password e recupero password.
- Gestione membri, ruoli e inviti monouso con scadenza, revoca e accettazione atomica.
- Email transazionali tramite Resend quando `RESEND_API_KEY` e `EMAIL_FROM` sono configurati.
- Audit log, rate limiting persistente e controlli di sicurezza del runtime.

## Autorizzazioni

| Ruolo | Accesso previsto |
|---|---|
| Admin | Gestione completa di dati, funnel, membri, inviti e audit |
| Editor | Lettura e modifica di clienti/funnel, import ed export |
| Analyst | Lettura analitica, clienti e funnel; export |
| Viewer | Sola lettura delle viste consentite |

Le autorizzazioni sono applicate dal server tramite middleware per permesso. I controlli nel frontend sono solo presentazionali e non sostituiscono i controlli API.

## Database e avvio sicuro

Le migrazioni SQL versionate (001–013) usano checksum e advisory lock. Le migrazioni sono applicate con un comando amministrativo esplicito; lo startup del server non esegue DDL.

All'avvio il server:
- richiede una modalità esplicita `NODE_ENV=development|test|production`;
- verifica che lo storico migrazioni e i checksum coincidano;
- verifica i privilegi del ruolo runtime;
- rifiuta l'avvio se schema o privilegi non sono conformi.

Il ruolo runtime deve essere distinto dal proprietario e non deve avere privilegi elevati. Le operazioni di migrazione e bootstrap richiedono un ruolo amministrativo separato.

## API principali

| Area | Endpoint |
|---|---|
| Autenticazione | `/api/auth/login`, `/api/auth/session`, `/api/auth/logout` |
| Inviti | `/api/invitations`, `/api/invitations/accept`, `/api/invitations/:id/revoke` |
| Analisi | `/api/meta`, `/api/summary`, `/api/channels`, `/api/timeseries` |
| Clienti | `/api/customers`, `/api/customers/:id` |
| Funnel | `/api/funnel-stages`, `/api/funnel-stages/:id` |
| Import | `/api/import` |
| Segmentazione | `/api/segments`, `/api/segments/customers` |
| Export | `/api/export/customers.csv`, `/api/export/organization.json` |
| Organizzazione | `/api/organization`, `/api/members`, `/api/invitations` |
| Audit | `/api/audit` |

## Limiti e stato di rilascio

La CI su PostgreSQL temporaneo verifica test, build, migrazioni, checksum, RLS, avvio con ruolo limitato e un percorso browser automatizzato. Queste prove non attestano che il database remoto sia già stato migrato né sostituiscono un collaudo staging.

Prima di un rilascio commerciale sono ancora necessari:
- matrice completa delle autorizzazioni e test cross-tenant su tutte le API e operazioni;
- collaudo su staging separato, inclusi email e flussi di recupero account;
- backup e ripristino realmente eseguiti su un database isolato;
- test di carico, monitoraggio, allarmi, rollback e procedure operative;
- revisione indipendente di sicurezza e valutazione privacy/contrattuale.

Nessuna operazione remota, migrazione su Neon o deploy è implicata dal superamento della CI. Il gate vincolante è `docs/GATE_RILASCIO.md`.


## Autenticazione, credenziali e sessioni

Le password sono memorizzate con scrypt, salt casuale da 16 byte e derivazione da 64 byte. Le nuove credenziali usano `N=32768`, `r=8`, `p=3`. Gli hash legacy `p=1` restano verificabili e vengono aggiornati al parametro corrente al successivo accesso riuscito o accettazione di un invito, senza richiedere un reset forzato.

Per ridurre l'enumerazione degli account tramite tempi di risposta, un'identità non trovata esegue una verifica scrypt fittizia. Il login applica limiti per IP, coppia IP/email e account; il recupero password applica limiti per IP e indirizzo email. I token di invito e recupero sono monouso, persistiti solo come hash e consegnati nei frammenti URL; il client li rimuove dalla barra indirizzi dopo averli acquisiti e mantiene la compatibilità con i vecchi link query.

La verifica della password e la creazione della sessione sono separate nel tempo: per evitare che una password appena sostituita consenta una sessione tardiva, il repository blocca la riga utente, ricontrolla l'hash esatto verificato e, se necessario, aggiorna l'hash legacy e inserisce la sessione nella stessa transazione. Un reset o cambio password concorrente si serializza rispetto a questa operazione.

In produzione lo startup verifica tramite `pg_stat_ssl` che la connessione PostgreSQL effettiva sia cifrata con TLS; in caso contrario il processo non si avvia. La pulizia dei bucket di rate limiting e dei token di recupero scaduti è disponibile tramite `npm run db:cleanup-login-attempts` e deve essere schedulata giornalmente. Prima del pilot è richiesto anche un controllo esplicito su MFA/SSO per gli account privilegiati, come indicato nel gate di rilascio.
