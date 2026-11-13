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
| Migrazioni | `server/migrations/001`–`008` |
| Runner | `server/src/postgres-migrations.ts` |
| Preflight | `server/src/postgres-runtime-preflight.ts` |
| Autenticazione | `postgres-authentication.ts`, `postgres-auth-*`, `postgres-session-*` |
| Tenant | `tenant-transaction.ts` e repository PostgreSQL |
| API | `postgres-app.ts` |
| Inviti | `postgres-invitations-repository.ts`, migration 008 e schermata admin |
| Audit | repository clienti, funnel, import, membership e inviti |
| Export | `postgres-export-repository.ts` |

## CI

- Il commit `c55284a` ha superato test, build, migrazioni 001–008, verifica checksum e smoke test runtime con ruolo limitato su Node.js 20 e 22: run [43470634828](https://github.com/saales/customer-journey-dashboard/actions/runs/43470634828).
- La CI usa PostgreSQL temporaneo e non accede a Neon.

## Verifiche remote non eseguite

- Nessuna query è stata eseguita sul database Neon in questa attività.
- Non è stato dimostrato che le migrazioni 001–008 siano già applicate sul database remoto.
- Non sono stati verificati checksum, ruoli, policy RLS e privilegi effettivi remoti.
- Non è stato effettuato alcun trasferimento di dati preesistenti.
- Non sono state eseguite scritture, DDL o bootstrap remoti.

## Limiti prima del rilascio

Restano necessari test browser end-to-end completi, test di carico, prova backup/restore, verifica database remoto, staging, osservabilità e invio email automatico/recupero account. Fino ad allora il prodotto non va presentato come pronto per dati aziendali reali o vendita.

## Manutenzione sicurezza — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Pulizia in batch dei record HMAC del rate limiter oltre retention | `cleanupPostgresLoginAttemptLimits` | Implementata; comando pianificabile giornalmente |
| Configurazione esplicita dei proxy attendibili per risolvere l'IP client | `TRUSTED_PROXY_IPS`, `req.ip` e `validateTrustedProxyIps` | Implementata; richiede configurazione corretta del reverse proxy |
| Test retention/batch e validazione IP/CIDR | test unitari e PostgreSQL integration | Aggiunti; CI da verificare sul commit successivo |

## Collaudo browser end-to-end — 13 novembre 2026

- Run CI [43492421898](https://github.com/saales/customer-journey-dashboard/actions/runs/43492421898), commit `a7f6c3139296f3b2ef2091e5c87c7006b504b62e`: concluso con successo su Node.js 20 e 22.
- Il job Node.js 22 ha eseguito Playwright/Chromium su PostgreSQL temporaneo e tenant sintetico.
- Flusso verificato: login admin, creazione cliente, aggiunta fase funnel, importazione CSV, esportazione CSV, invito e accettazione analista, controllo HTTP 403 sulla creazione cliente invocata direttamente dall'analista.
- Non è un test completo di tutti i ruoli o dell'isolamento cross-tenant; non sono stati eseguiti test di carico.
- Il test non accede al database Neon, non usa dati reali e non effettua deploy.

## Hardening del preflight runtime

- Il preflight verifica anche SELECT/INSERT/UPDATE/DELETE sulla tabella globale `api_request_limits`, introdotta dalla migrazione 009.
- Test unitario negativo dedicato: un ruolo senza INSERT su `api_request_limits` deve fallire il preflight.
