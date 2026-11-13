# ADR-0001 — Isolamento multi-tenant PostgreSQL

- **Stato:** adottata e implementata nel runtime applicativo
- **Ambito:** server HTTP, repository e schema PostgreSQL
- **Vincolo operativo:** le migrazioni remote sono esplicite; lo startup è read-only

## Decisione

1. L'identità organizzativa deriva esclusivamente dalla sessione server-side e dalla membership attiva.
2. Ogni repository tenant-scoped riceve l'ID organizzazione autenticato e filtra esplicitamente le query.
3. Le relazioni tra risorse tenant-scoped usano chiavi e foreign key composite ove previsto dallo schema.
4. Le tabelle operative applicano Row-Level Security con contesto `app.current_organization_id` impostato nella stessa transazione delle query.
5. Il ruolo HTTP non deve essere superuser, proprietario delle tabelle o avere `BYPASSRLS`; migrazioni e bootstrap usano credenziali separate.
6. Le operazioni di scrittura sono protette da verifica Origin e autorizzazione per ruolo/permesso.

## Implementazione

Il middleware risolve sessione, utente, organizzazione e ruolo; `withTenantTransaction` imposta il contesto RLS e i repository applicano filtri espliciti. I test d'integrazione PostgreSQL usano organizzazioni distinte e verificano l'isolamento a livello repository. Il preflight del runtime controlla proprietà e privilegi del ruolo database.

## Limiti e verifiche residue

I test PostgreSQL temporanei non provano lo stato dell'istanza remota. Prima del rilascio occorre verificare sul database effettivo lo storico migrazioni, i ruoli, le policy RLS, i backup e il ripristino. Servono inoltre test HTTP end-to-end cross-tenant e test browser con sessioni reali.

## Riferimenti

- PostgreSQL — [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- PostgreSQL — [SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html)