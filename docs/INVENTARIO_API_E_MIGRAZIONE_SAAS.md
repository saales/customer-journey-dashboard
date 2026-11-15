# Inventario API — runtime PostgreSQL

## Stato

Il runtime standard usa PostgreSQL. L'organizzazione deriva dalla sessione autenticata e non da parametri inviati dal browser.

## Endpoint

| Metodo | Endpoint | Permesso / controllo | Funzione |
|---|---|---|---|
| GET | `/api/health` | Pubblico | Readiness database |
| POST | `/api/auth/login` | Pubblico + rate limit + Origin | Login e sessione |
| GET | `/api/auth/session` | Cookie sessione | Stato sessione e ruolo |
| POST | `/api/auth/logout` | Sessione + Origin | Revoca sessione |
| POST | `/api/auth/password-reset/request` | Pubblico + Origin + rate limit | Richiesta recupero password |
| POST | `/api/auth/password-reset/complete` | Token monouso + Origin | Reimpostazione password |
| POST | `/api/invitations/accept` | Token invito + Origin | Accettazione monouso e sessione |
| GET/POST | `/api/invitations` | `members:manage` | Elenco e creazione inviti |
| POST | `/api/invitations/:id/revoke` | `members:manage` | Revoca invito |
| GET | `/api/meta` | `analytics:read` | Intervallo dati e canali |
| GET | `/api/summary` | `analytics:read` | KPI e funnel |
| GET | `/api/channels` | `analytics:read` | Confronto canali |
| GET | `/api/timeseries` | `analytics:read` | Andamento mensile |
| GET/POST | `/api/customers` | `customers:read` / `customers:write` | Elenco e creazione |
| PUT/DELETE | `/api/customers/:id` | `customers:write` | Modifica ed eliminazione tenant-scoped |
| GET/POST/PUT | `/api/funnel-stages` | `funnel:read` / `funnel:write` | Consultazione e configurazione fasi |
| PUT | `/api/funnel-stages/reorder` | `funnel:write` | Riordino fasi |
| POST | `/api/import` | `data:import` | Importazione tenant-scoped |
| GET | `/api/segments` | `analytics:read` | Segmentazione |
| GET | `/api/segments/customers` | `analytics:read` | Dettaglio segmento |
| GET | `/api/export/customers.csv` | `data:export` | Esportazione clienti/eventi |
| GET | `/api/export/organization.json` | `data:export` | Esportazione dati organizzazione |
| GET/PATCH | `/api/account` | Sessione valida | Profilo e modifica nome |
| GET | `/api/account/sessions` | Sessione valida | Elenco sessioni account |
| DELETE | `/api/account/sessions/:sessionId` | Sessione valida | Revoca sessione account |
| POST | `/api/account/password` | Sessione valida + password attuale | Cambio password e revoca sessioni |
| GET/PATCH | `/api/organization` | `members:manage` | Lettura e modifica nome organizzazione |
| GET | `/api/members` | `members:manage` | Elenco membri |
| PATCH | `/api/members/:id` | `members:manage` | Ruolo e stato membro |
| GET | `/api/audit` | `audit:read` | Registro attività amministrative |

## Ruoli

| Ruolo | Permessi |
|---|---|
| Admin | Tutti |
| Editor | Analisi, lettura/scrittura clienti e funnel, importazione/esportazione |
| Analyst | Analisi, lettura clienti/funnel ed esportazione |
| Viewer | Analisi e lettura clienti/funnel |

## Controlli

- Le scritture richiedono Origin autorizzato.
- Le API protette richiedono sessione valida e membership attiva.
- Risposte `no-store`; JSON ordinario 1 MiB, import 12 MiB.
- CSV clienti limitato a 100.000 righe e protetto da formula injection.
- Inviti con token casuale monouso, hash SHA-256 persistito, scadenza e revoca.
- Recupero password con token monouso hashato, scadenza 30 minuti e revoca delle sessioni.
- Le email transazionali per inviti e recupero password usano Resend quando `RESEND_API_KEY` e `EMAIL_FROM` sono configurati. La consegna reale richiede verifica del dominio e test del provider.
- Il registro audit è riservato al ruolo admin.

## Funzioni non presenti o non certificate

- Provisioning self-service e fatturazione/piani commerciali non sono implementati in questo ramo.
- La consegna email reale non è stata verificata con credenziali e dominio Resend.
- Non tutte le route e tutte le operazioni sono ancora coperte da test cross-tenant automatizzati.
- Il CSV clienti e l'export JSON dell'organizzazione sono server-side; gli altri report visuali possono essere esportati dal browser.
