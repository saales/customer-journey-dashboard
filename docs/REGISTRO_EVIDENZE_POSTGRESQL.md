# Registro delle evidenze tecniche

## Stato del ramo

Ramo: `recovery/checkpoint-12-postgres`  
Pull request: [#1](https://github.com/saales/customer-journey-dashboard/pull/1) (aperta, in bozza)  
Database applicativo previsto: PostgreSQL  
Stato del database remoto: non verificato in questa attività.

## Evidenze codice

| Area | Evidenza nel repository |
|---|---|
| Runtime unico | `server/src/postgres-server.ts`; script standard in `package.json` e `server/package.json` |
| Pool PostgreSQL | `server/src/postgres.ts` |
| Migrazioni | `server/migrations/001_initial_schema.sql`–`007_membership_management.sql` |
| Runner e checksum | `server/src/postgres-migrations.ts` |
| Preflight ruolo | `server/src/postgres-runtime-preflight.ts` |
| Autenticazione e sessioni | `server/src/postgres-authentication.ts`, `postgres-session-*`, `postgres-auth-*` |
| Isolamento tenant | `server/src/tenant-transaction.ts` e repository PostgreSQL |
| Clienti e funnel | `postgres-customer-repository.ts`, `postgres-funnel-repository.ts` |
| Analisi e segmentazione | `postgres-analytics-repository.ts`, `postgres-segmentation-repository.ts` |
| Importazione/esportazione | `postgres-import-repository.ts`, `postgres-export-repository.ts` |
| Membri | `postgres-members-repository.ts` e API `/api/members` |

## Evidenze CI

- Il commit `147e5579` ha superato la pipeline su Node.js 20 e 22, con test e build: run [43465811359](https://github.com/saales/customer-journey-dashboard/actions/runs/43465811359).
- Il commit successivo che rende PostgreSQL il runtime standard deve essere verificato nuovamente: il risultato della CI non va dedotto da quello del commit precedente.
- La CI usa un PostgreSQL temporaneo; non accede a Neon.

## Verifiche remote non eseguite

- Nessuna query è stata eseguita sul database Neon in questa attività.
- Non è stato dimostrato che le migrazioni 001–007 siano già applicate sul database remoto.
- Non è stato verificato il checksum remoto, il ruolo applicativo remoto, le policy RLS effettive o i privilegi effettivi.
- Non è stato effettuato alcun trasferimento di dati preesistenti.
- Non sono state eseguite operazioni DDL, bootstrap o scritture remote.

## Limiti prima del rilascio

Restano necessari test browser end-to-end, test di carico, prova backup/restore, verifica del database remoto, staging, osservabilità e completamento dei flussi invito/recupero account. Fino ad allora il prodotto non deve essere presentato come pronto per dati aziendali reali o vendita.