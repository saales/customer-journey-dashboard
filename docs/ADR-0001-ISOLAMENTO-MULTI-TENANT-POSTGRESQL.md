# ADR-0001 — Isolamento multi-tenant PostgreSQL

- **Stato:** adottata e implementata nel runtime applicativo
- **Ambito:** server HTTP, repository e schema PostgreSQL
- **Vincolo:** le migrazioni remote sono esplicite; lo startup è read-only

## Decisione

1. L'identità organizzativa deriva esclusivamente dalla sessione server-side e dalla membership attiva.
2. Ogni repository tenant-scoped riceve l'organizzazione autenticata e applica filtri espliciti.
3. Le tabelle operative applicano Row-Level Security con contesto `app.current_organization_id` impostato nella stessa transazione.
4. Il ruolo HTTP non è superuser, proprietario delle tabelle o `BYPASSRLS`; migrazioni e bootstrap usano credenziali separate.
5. Le scritture richiedono Origin autorizzato e permesso esplicito per ruolo.
6. Inviti e membership sono limitati all'organizzazione; i token invito sono monouso e nel database viene conservato solo l'hash.

## Implementazione

Il middleware risolve sessione, utente, organizzazione e ruolo; `withTenantTransaction` imposta il contesto RLS. I repository applicano filtri espliciti. I test d'integrazione usano PostgreSQL temporaneo e organizzazioni distinte. Il preflight controlla proprietà e privilegi del ruolo runtime.

## Limiti

La CI su database temporaneo non dimostra lo stato dell'istanza remota. Prima del rilascio occorrono verifica di migrazioni, ruoli, policy RLS, backup e ripristino sul database effettivo, oltre a test HTTP/browser cross-tenant.

## Riferimenti

- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html)