# Registro delle evidenze tecniche

## Stato del ramo

Ramo: `recovery/checkpoint-12-postgres`  
Pull request: [#1](https://github.com/saales/customer-journey-dashboard/pull/1), aperta e in bozza  
Database applicativo: PostgreSQL  
Stato database remoto: non verificato in questa attività.

## Evidenze codice

| Area | Evidenza |
|---|---|
| Runtime unico | `server/src/postgres-server.ts`; script standard root e server |
| Pool | `server/src/postgres.ts` |
| Migrazioni | `server/migrations/001`–`010` |
| Runner | `server/src/postgres-migrations.ts` |
| Preflight | `server/src/postgres-runtime-preflight.ts` |
| Autenticazione | `postgres-authentication.ts`, `postgres-auth-*`, `postgres-session-*` |
| Tenant | `tenant-transaction.ts` e repository PostgreSQL |
| API | `postgres-app.ts` |
| Inviti | `postgres-invitations-repository.ts`, migration 008 e schermata admin |
| Audit | repository clienti, funnel, import, membership e inviti |
| Export | `postgres-export-repository.ts`; evento audit `data.exported` nella stessa transazione |

## CI

- Il commit `7570eb3bcfd64787aa7c8ab19a8a2ee68c504d53` ha superato test, build, audit dipendenze, migrazioni 001–010, verifica checksum e avvio runtime con ruolo limitato su Node.js 20 e 22: run [43493813499](https://github.com/saales/customer-journey-dashboard/actions/runs/43493813499).
- Sul runtime Node.js 22 la stessa CI ha completato Playwright/Chromium su PostgreSQL temporaneo e tenant sintetico.
- La CI usa PostgreSQL temporaneo e non accede a Neon.

## Verifiche remote non eseguite

- Nessuna query è stata eseguita sul database Neon in questa attività.
- Non è stato dimostrato che le migrazioni 001–010 siano già applicate sul database remoto.
- Non sono stati verificati checksum, ruoli, policy RLS e privilegi effettivi remoti.
- Non è stato effettuato alcun trasferimento di dati preesistenti.
- Non sono state eseguite scritture, DDL o bootstrap remoti.

## Limiti prima del rilascio

Restano necessari il completamento della matrice browser per tutti i ruoli e dei casi cross-tenant, test di carico, prova backup/restore, verifica database remoto, staging, osservabilità e invio email automatico/recupero account. Il percorso browser admin/analista rappresentativo è stato superato nella CI descritta sotto. Fino ad allora il prodotto non va presentato come pronto per dati aziendali reali o vendita.

## Manutenzione sicurezza — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Pulizia in batch dei record HMAC del rate limiter oltre retention | `cleanupPostgresLoginAttemptLimits` | Implementata; comando pianificabile giornalmente |
| Configurazione esplicita dei proxy attendibili per risolvere l'IP client | `TRUSTED_PROXY_IPS`, `req.ip` e `validateTrustedProxyIps` | Implementata; richiede configurazione corretta del reverse proxy |
| Test retention/batch e validazione IP/CIDR | test unitari e PostgreSQL integration | Aggiunti; CI verde sul commit `7570eb3` (run [43493813499](https://github.com/saales/customer-journey-dashboard/actions/runs/43493813499)) |

## Collaudo browser end-to-end — 13 novembre 2026

- Run CI [43493813499](https://github.com/saales/customer-journey-dashboard/actions/runs/43493813499), commit `7570eb3bcfd64787aa7c8ab19a8a2ee68c504d53`: concluso con successo su Node.js 20 e 22.
- Il job Node.js 22 ha eseguito Playwright/Chromium su PostgreSQL temporaneo e tenant sintetico.
- Flusso verificato: login admin, creazione cliente, aggiunta fase funnel, importazione CSV, export admin, invito e accettazione analista, export analista, rifiuto HTTP 403 della lettura audit e della creazione cliente invocata direttamente dall'analista, logout e revoca sessione verificata con HTTP 401.
- Non è un test completo di tutti i ruoli o dell'isolamento cross-tenant; non sono stati eseguiti test di carico.
- Il test non accede al database Neon, non usa dati reali e non effettua deploy.

## Hardening del preflight runtime

- Il preflight verifica anche SELECT/INSERT/UPDATE/DELETE sulla tabella globale `api_request_limits`, introdotta dalla migrazione 009.
- Test unitario negativo dedicato: un ruolo senza INSERT su `api_request_limits` deve fallire il preflight. Il preflight ora riporta anche il dettaglio dei privilegi o delle configurazioni non conformi.


## Correzione emersa dal collaudo browser — 13 novembre 2026

- Il test Playwright ha individuato una regressione non coperta dal percorso precedente: dopo l'esportazione CSV, la lettura di `/api/audit` come amministratore restituiva HTTP 500.
- I log PostgreSQL hanno identificato la causa: il ruolo runtime disponeva di `INSERT` su `audit_logs`, ma non di `SELECT`, necessario per la query di consultazione. Il controllo dei privilegi non rilevava questa mancanza.
- Aggiunta la migrazione incrementale `010_audit_log_read_grant.sql`: concede esclusivamente `SELECT` su `audit_logs` al ruolo `percorso_app`. La policy RLS continua a limitare le righe al tenant impostato dalla sessione; il controllo autorizzativo HTTP continua a riservare l'endpoint agli amministratori.
- Aggiornati il runner delle migrazioni, il preflight del ruolo runtime, il test negativo per il privilegio mancante e il test d'integrazione che verifica il grant della migrazione 010.
- Il test browser già presente verifica la lettura audit amministrativa dopo l'export; il suo esito dopo la correzione è ancora da confermare nella CI del commit aggiornato.
