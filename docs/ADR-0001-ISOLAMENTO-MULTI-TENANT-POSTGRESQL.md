# ADR-0001 — Isolamento multi-tenant PostgreSQL

- **Stato:** proposta tecnica, non implementata
- **Ambito:** futuro backend PostgreSQL del Customer Journey Dashboard
- **Vincolo:** non applicare migrazioni o query di scrittura a Neon durante la ricostruzione

## Contesto verificato

Il backend HTTP attuale usa `better-sqlite3`: `createApp(db)` riceve un database SQLite e le query applicative interrogano tabelle senza `organization_id`. Il modulo `server/src/postgres.ts` crea un pool `pg` e verifica la connettività, ma non è collegato alle route runtime. Quindi la connessione PostgreSQL attuale non fornisce persistenza SaaS né isolamento tenant.

## Decisione proposta

Adottare isolamento a più livelli, senza affidarsi a un singolo middleware:

1. **Identità affidabile:** il middleware risolve la sessione server-side e ricava `user_id`, `organization_id` e ruolo dalla membership attiva. Non accetta l'organizzazione indicata dal browser come autorità.
2. **Scope applicativo obbligatorio:** ogni repository riceve un contesto tenant tipizzato e ogni query su dati aziendali filtra esplicitamente `organization_id`.
3. **Vincoli relazionali:** le tabelle tenant-scoped usano chiavi uniche e foreign key composite che includono `organization_id`, così un record non può riferirsi a una risorsa appartenente a un'altra organizzazione.
4. **Row-Level Security (RLS):** valutare RLS come difesa aggiuntiva per le tabelle tenant-scoped, non come sostituto dell'autorizzazione applicativa o dei vincoli.
5. **Ruolo DB limitato:** il ruolo usato dal servizio non deve essere superuser, proprietario delle tabelle o avere `BYPASSRLS`. Le operazioni amministrative e le migrazioni usano credenziali separate, non disponibili al processo HTTP.

## Contesto tenant con pool di connessioni

Se RLS usa una variabile di sessione PostgreSQL, impostarla in modo transazionale e locale alla transazione, non lasciarla sullo stato persistente della connessione riutilizzata dal pool.

Pattern concettuale da validare in test:

```sql
BEGIN;
SELECT set_config('app.organization_id', $1, true);
-- query tenant-scoped eseguite sullo stesso client
COMMIT;
```

Il terzo argomento `true` rende il parametro locale alla transazione. Il codice applicativo deve acquisire un singolo client dal pool, eseguire BEGIN, impostare il contesto, eseguire tutte le query della richiesta/transazione, poi COMMIT o ROLLBACK e rilasciare il client in `finally`. Non usare `pool.query` per query che dipendono dal contesto transazionale perché potrebbero usare un'altra connessione.

Il valore del tenant deve provenire esclusivamente dal contesto autenticato server-side. La query che imposta il parametro deve essere parametrizzata.

## Criteri di test obbligatori

- Due organizzazioni A e B con utenti distinti: A non può leggere, elencare, aggiornare o cancellare record di B anche conoscendone gli ID.
- Creazione di eventi, import batch e funnel stage: foreign key composite rifiutano riferimenti cross-tenant.
- Ruoli viewer/analyst: ogni mutazione viene rifiutata dal server.
- Ruoli editor/admin: mutazioni consentite solo secondo la matrice di autorizzazione approvata.
- Pool reuse: dopo una transazione per A, la stessa connessione riutilizzata da B non conserva il contesto A.
- Rollback: errori durante import e scritture multi-record non lasciano dati parziali.
- RLS: test con lo stesso ruolo DB usato dall'applicazione, non con il proprietario dello schema.
- Verificare esplicitamente il comportamento di owner, superuser e ruoli con `BYPASSRLS`: PostgreSQL documenta eccezioni e bypass, quindi RLS non è una garanzia se il ruolo runtime può aggirarla.

## Rischi e cautele

- I controlli referenziali di integrità, inclusi foreign key e primary key, non sono filtrati da RLS: progettare i vincoli per non creare canali di inferenza cross-tenant.
- Non creare policy permissive che si combinino involontariamente con OR. Se sono presenti più policy, verificarne la composizione e usare policy restrictive quando necessario.
- `FORCE ROW LEVEL SECURITY` può essere necessario per sottoporre anche il proprietario della tabella alle policy, ma non rende innocuo un superuser o un ruolo con `BYPASSRLS`.
- Health check pubblici devono esporre solo uno stato sintetico, mai stringhe di connessione, nomi utente o dettagli di query.

## Fonti ufficiali

- PostgreSQL — [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- PostgreSQL — [SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html)

## Condizione di accettazione

Questa ADR è una proposta. Non dichiarare RLS o tenant isolation implementati finché schema, ruolo runtime, middleware, repository e test cross-tenant non sono presenti e verificati su PostgreSQL effimero in CI. Nessun comando di migrazione va eseguito su Neon per convalidare questa proposta.
