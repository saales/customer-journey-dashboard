# Inventario API e stato del runtime PostgreSQL

## Stato

Il runtime standard è PostgreSQL. Il client web usa le API same-origin del server Express; l'identità organizzativa deriva dalla sessione e non da parametri inviati dal client.

## Endpoint

| Metodo | Endpoint | Permesso | Funzione |
|---|---|---|---|
| GET | `/api/health` | Pubblico | Readiness del database |
| POST | `/api/auth/login` | Pubblico + rate limit | Autenticazione e creazione sessione |
| GET | `/api/auth/session` | Cookie sessione | Stato sessione e ruolo |
| POST | `/api/auth/logout` | Cookie sessione + Origin | Revoca sessione |
| GET | `/api/meta` | `analytics:read` | Intervallo dati e canali |
| GET | `/api/summary` | `analytics:read` | KPI e funnel |
| GET | `/api/channels` | `analytics:read` | Confronto canali |
| GET | `/api/timeseries` | `analytics:read` | Andamento mensile |
| GET/POST | `/api/customers` | `customers:read` / `customers:write` | Elenco paginato e creazione |
| PUT/DELETE | `/api/customers/:id` | `customers:write` | Modifica ed eliminazione |
| GET/POST/PUT | `/api/funnel-stages` | `funnel:read` / `funnel:write` | Configurazione fasi |
| PUT | `/api/funnel-stages/reorder` | `funnel:write` | Riordino fasi |
| POST | `/api/import` | `data:import` | Importazione tenant-scoped |
| GET | `/api/segments` | `analytics:read` | Segmentazione |
| GET | `/api/segments/customers` | `analytics:read` | Dettaglio segmento |
| GET | `/api/export/customers.csv` | `data:export` | Esportazione clienti ed eventi |
| GET | `/api/members` | `members:manage` | Elenco membri |
| PATCH | `/api/members/:id` | `members:manage` | Ruolo e stato membro |

## Matrice sintetica dei ruoli

| Ruolo | Permessi |
|---|---|
| Admin | Tutti |
| Editor | Analisi, lettura/scrittura clienti e funnel, importazione ed esportazione |
| Analyst | Analisi, lettura clienti/funnel ed esportazione |
| Viewer | Analisi e lettura clienti/funnel |

## Comportamenti e controlli

- Le richieste di scrittura richiedono un Origin autorizzato.
- Le API protette richiedono una sessione valida e membership attiva.
- Le risposte API sono marcate `no-store`.
- Le richieste JSON ordinarie hanno limite 1 MiB; importazioni 12 MiB.
- L'esportazione clienti è limitata a 100.000 righe per richiesta e neutralizza celle che potrebbero essere interpretate come formule.
- L'endpoint di health restituisce uno stato sintetico e non espone credenziali.

## Funzioni non ancora disponibili

Invito utenti con consegna email, recupero password/account, provisioning self-service e audit viewer nell'interfaccia non sono ancora completati. L'esportazione aggregata dei report avviene nel browser; l'endpoint server-side copre clienti ed eventi.