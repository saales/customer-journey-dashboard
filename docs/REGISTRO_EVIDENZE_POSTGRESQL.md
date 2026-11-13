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
| Audit | repository clienti, funnel, import, membership, inviti ed export CSV |
| Export | `postgres-export-repository.ts`; evento audit `data.exported` nella stessa transazione |

## CI

- Il commit `d9f2c296aac62cbdcddb002f318c2a3bab024547` ha superato test, build, audit dipendenze, migrazioni 001–010, verifica checksum e avvio runtime con ruolo limitato su Node.js 20 e 22: run [43495637026](https://github.com/saales/customer-journey-dashboard/actions/runs/43495637026).
- Sul runtime Node.js 22 la stessa CI ha completato Playwright/Chromium su PostgreSQL temporaneo e tenant sintetico, verificando anche la registrazione e consultazione amministrativa dell'export CSV.
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

- Run CI [43495637026](https://github.com/saales/customer-journey-dashboard/actions/runs/43495637026), commit `d9f2c296aac62cbdcddb002f318c2a3bab024547`: concluso con successo su Node.js 20 e 22.
- Il job Node.js 22 ha eseguito Playwright/Chromium su PostgreSQL temporaneo e tenant sintetico.
- Flusso verificato: login admin, creazione cliente, aggiunta fase funnel, importazione CSV, export admin, invito e accettazione analista, export analista, rifiuto HTTP 403 della lettura audit e della creazione cliente invocata direttamente dall'analista, logout e revoca sessione verificata con HTTP 401.
- Non è un test completo di tutti i ruoli o dell'isolamento cross-tenant; non sono stati eseguiti test di carico.
- Il test non accede al database Neon, non usa dati reali e non effettua deploy.

## Migrazione 010 — lettura audit tenant-scoped

- La suite E2E ha evidenziato che il ruolo runtime poteva inserire audit, ma non leggere il registro: il preflight non rilevava il privilegio SELECT mancante.
- Aggiunta migrazione 010 per concedere SELECT su `audit_logs` al ruolo applicativo, senza modificarne proprietà, RLS o privilegi di scrittura ulteriori.
- Il preflight ora richiede e verifica anche `audit_logs:SELECT`; test negativo dedicato per il ruolo privo di questo privilegio.
- Il test browser verifica che l'export admin generi l'evento `data.exported` consultabile dall'amministratore e che l'analista resti privo di `audit:read`.

## Hardening del preflight runtime

- Il preflight verifica anche SELECT/INSERT/UPDATE/DELETE sulla tabella globale `api_request_limits`, introdotta dalla migrazione 009.
- Test unitario negativo dedicato: un ruolo senza INSERT su `api_request_limits` deve fallire il preflight. Il preflight ora riporta anche il dettaglio dei privilegi o delle configurazioni non conformi.


## Correzione emersa dal collaudo browser — 13 novembre 2026

- Il test Playwright ha individuato una regressione non coperta dal percorso precedente: dopo l'esportazione CSV, la lettura di `/api/audit` come amministratore restituiva HTTP 500.
- I log PostgreSQL hanno identificato la causa: il ruolo runtime disponeva di `INSERT` su `audit_logs`, ma non di `SELECT`, necessario per la query di consultazione. Il controllo dei privilegi non rilevava questa mancanza.
- Aggiunta la migrazione incrementale `010_audit_log_read_grant.sql`: concede esclusivamente `SELECT` su `audit_logs` al ruolo `percorso_app`. La policy RLS continua a limitare le righe al tenant impostato dalla sessione; il controllo autorizzativo HTTP continua a riservare l'endpoint agli amministratori.
- Aggiornati il runner delle migrazioni, il preflight del ruolo runtime, il test negativo per il privilegio mancante e il test d'integrazione che verifica il grant della migrazione 010.
- Il test browser già presente verifica la lettura audit amministrativa dopo l'export; il suo esito dopo la correzione è ancora da confermare nella CI del commit aggiornato.


## Verifica ruoli estesa — 13 novembre 2026

- Il test middleware verifica l'insieme esatto dei permessi previsti per ciascun ruolo: admin, editor, analyst e viewer.
- Il percorso Playwright include ora admin, analyst e viewer. L'analista può esportare ma non scrivere né leggere l'audit; il viewer può leggere ma non esportare, scrivere o consultare l'audit. Le negazioni API sono verificate con HTTP 403 oltre ai controlli di visibilità UI.
- Run CI [43499933923](https://github.com/saales/customer-journey-dashboard/actions/runs/43499933923) sul commit `b64e6cd8f7ca278b612784ab25727f592d05a3e8`: Node.js 20 e 22 completati con successo; test, build, audit, migrazioni 001–010/checksum e avvio runtime limitato; su Node.js 22 anche bootstrap tenant sintetico e Playwright/Chromium.
- I test PostgreSQL di migrazione verificano RLS con un ruolo non proprietario e due organizzazioni. Rimangono necessari casi API cross-tenant più estesi e un percorso browser dedicato al ruolo editor.
- Non sono state eseguite verifiche o scritture su Neon; staging, backup/restore, monitoraggio, carico e revisione indipendente restano fuori da questa CI.


## Verifica browser del ruolo editor — 13 novembre 2026

- Esteso `e2e/customer-journey.spec.ts` con invito e accettazione reali del ruolo editor nel PostgreSQL effimero della CI.
- Il browser verifica che l'editor possa creare clienti, aggiungere fasi funnel, importare ed esportare CSV; verifica inoltre HTTP 403 su audit e gestione membri.
- CI [43502016449](https://github.com/saales/customer-journey-dashboard/actions/runs/43502016449), commit `c2c3112c9562add0d98ed7f28b14dad79c37620e`: successo su Node.js 20 e 22. Entrambi i runtime hanno superato `npm ci`, npm audit, test, build, migrazioni 001–010, verifica storico/checksum e avvio PostgreSQL con ruolo runtime limitato. Su Node.js 22 è passato anche Playwright/Chromium con gli scenari admin, analyst, viewer ed editor.
- La pipeline usa un database temporaneo e dati sintetici; non costituisce una verifica del database Neon né una prova completa di isolamento API cross-tenant.


## Recupero account, inviti email e impostazioni organizzazione — 13 novembre 2026

- Migrazione incrementale 011: token di recupero password con SHA-256, scadenza 30 minuti, uso singolo, revoca atomica di tutte le sessioni e grant limitato alla modifica di `users.password_hash` e `updated_at`.
- Endpoint pubblici di richiesta e completamento recupero: risposta generica per evitare enumerazione account, verifica Origin, rate limiting API condiviso e aggiornamento password con scrypt.
- Adapter email transazionale per Resend. Se `RESEND_API_KEY` e `EMAIL_FROM` non sono configurati, l'invio automatico resta disattivato; i link invito restano condivisibili manualmente. Nessuna email reale è stata inviata o verificata.
- La UI di accesso include richiesta e completamento recupero password; la UI amministrativa mostra lo stato dell'invio invito.
- Migrazione incrementale 012: concede soltanto UPDATE sulle colonne `organizations.name` e `updated_at`. API amministrative e UI per leggere/aggiornare nome, slug e data creazione; le modifiche generano audit event nella stessa transazione.
- Test unitari aggiunti per token monouso, revoca sessioni, provider email, audit e impostazioni organizzazione. CI su commit aggiornato ancora da completare.
- Le migrazioni 011–012 sono registrate nel runner; non sono state applicate al database Neon né ad altri database remoti.
