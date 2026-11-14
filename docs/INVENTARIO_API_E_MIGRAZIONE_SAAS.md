# Inventario API — runtime PostgreSQL

## Stato

Il runtime standard è PostgreSQL. L'organizzazione deriva dalla sessione autenticata e non da parametri inviati dal browser.

## Endpoint

| Metodo | Endpoint | Permesso | Funzione |
|---|---|---|---|
| GET | `/api/health` | Pubblico | Readiness database |
| POST | `/api/auth/login` | Pubblico + rate limit | Login e sessione |
| GET | `/api/auth/session` | Cookie sessione | Stato sessione e ruolo |
| POST | `/api/auth/logout` | Cookie + Origin | Revoca sessione |
| POST | `/api/invitations/accept` | Token invito + Origin | Accettazione monouso e sessione |
| GET/POST | `/api/invitations` | `members:manage` | Elenco e creazione inviti |
| POST | `/api/invitations/:id/revoke` | `members:manage` | Revoca invito |
| GET | `/api/meta` | `analytics:read` | Intervallo dati e canali |
| GET | `/api/summary` | `analytics:read` | KPI e funnel |
| GET | `/api/channels` | `analytics:read` | Confronto canali |
| GET | `/api/timeseries` | `analytics:read` | Andamento mensile |
| GET/POST | `/api/customers` | `customers:read` / `customers:write` | Elenco e creazione |
| PUT/DELETE | `/api/customers/:id` | `customers:write` | Modifica ed eliminazione |
| GET/POST/PUT | `/api/funnel-stages` | `funnel:read` / `funnel:write` | Configurazione fasi |
| PUT | `/api/funnel-stages/reorder` | `funnel:write` | Riordino fasi |
| POST | `/api/import` | `data:import` | Importazione tenant-scoped |
| GET | `/api/segments` | `analytics:read` | Segmentazione |
| GET | `/api/segments/customers` | `analytics:read` | Dettaglio segmento |
| GET | `/api/export/customers.csv` | `data:export` | Esportazione clienti/eventi |
| GET | `/api/members` | `members:manage` | Elenco membri |
| PATCH | `/api/members/:id` | `members:manage` | Ruolo e stato membro |

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
- Inviti con token casuale monouso, hash SHA-256 persistito, scadenza e revoca; il link viene mostrato una sola volta all'amministratore.

## Funzioni mancanti

Invio email automatico, recupero password/account, provisioning self-service e audit viewer non sono disponibili. I report aggregati vengono esportati dal browser; il CSV server-side copre clienti ed eventi.