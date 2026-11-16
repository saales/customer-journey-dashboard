# Architettura della piattaforma

## Obiettivo

Percorso Cliente è una piattaforma B2B per analizzare coorti, avanzamento del funnel e conversione, con dati separati per organizzazione.

## Architettura applicativa

- **Interfaccia:** React, TypeScript e Vite; richieste same-origin verso il server.
- **Server:** Node.js, Express e TypeScript, entrypoint `server/src/postgres-server.ts`.
- **Persistenza:** PostgreSQL tramite `pg`, unico database applicativo.
- **Identità:** sessioni opache memorizzate come hash, cookie HttpOnly e membership attiva.
- **Autorizzazione:** middleware server-side per ruolo e permesso.
- **Isolamento:** filtri espliciti per organizzazione e RLS sulle tabelle operative.
- **Migrazioni:** SQL versionato, checksum, advisory lock e preflight; lo startup non applica DDL.

## Flussi

1. Login con slug organizzazione, email e password.
2. Il server verifica credenziali e membership e crea una sessione opaca.
3. Le API protette risolvono la sessione; l'organizzazione non viene accettata dal browser come autorità.
4. I repository eseguono query tenant-scoped in transazioni PostgreSQL.
5. Le operazioni di importazione, membership, invito, clienti e funnel scrivono gli eventi di audit previsti.

## API

| Area | Endpoint principali |
|---|---|
| Accesso | `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`, `/api/auth/password-reset/*` |
| Inviti | `/api/invitations`, `/api/invitations/accept`, `/api/invitations/:id/revoke` |
| Analisi | `/api/meta`, `/api/summary`, `/api/channels`, `/api/timeseries` |
| Clienti | `/api/customers`, `/api/customers/:id` |
| Funnel | `/api/funnel-stages`, `/api/funnel-stages/:id` |
| Importazione | `/api/import` |
| Segmentazione | `/api/segments`, `/api/segments/customers` |
| Esportazione | `/api/export/customers.csv` |
| Membri | `/api/members`, `/api/members/:id` |
| Audit | `/api/audit` |

## Limiti

La CI applica le migrazioni 001–013 a PostgreSQL temporaneo e avvia il server con ruolo limitato. Non certifica la migrazione remota. I test browser coprono i quattro ruoli e alcuni casi cross-tenant, ma non tutte le API. Restano da fare staging, test di carico, prove backup/restore e verifica operativa del database remoto. Recupero password e invio email tramite Resend sono implementati; la consegna email reale dipende dalla configurazione e non è stata verificata.
