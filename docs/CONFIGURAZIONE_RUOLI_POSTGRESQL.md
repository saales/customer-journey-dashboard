# Configurazione dei ruoli PostgreSQL

Il servizio HTTP deve collegarsi con il ruolo `percorso_app`, mai con il proprietario delle tabelle o con un superuser. Le migrazioni devono essere applicate da un ruolo amministrativo/proprietario separato.

## Prerequisiti amministrativi

Creare i ruoli nel database prima di eseguire la migrazione `005_runtime_role_grants.sql`. Eseguire i comandi con un account amministrativo e sostituire i segnaposto senza inserirli nel repository:

```sql
CREATE ROLE percorso_owner LOGIN NOINHERIT PASSWORD '<password-proprietario>';
CREATE ROLE percorso_app LOGIN NOINHERIT PASSWORD '<password-applicazione>';
ALTER ROLE percorso_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
```

Il ruolo `percorso_owner` deve essere il proprietario delle tabelle e lo stesso ruolo usato per applicare le migrazioni. Se il database è già stato inizializzato con un altro proprietario, non trasferire la proprietà alla cieca: pianificare una procedura DBA specifica e verificare gli oggetti esistenti.

## Applicazione delle migrazioni

1. Eseguire il controllo preliminare con la connessione del proprietario.
2. Verificare che le versioni precedenti siano coerenti con il registro.
3. Applicare le migrazioni usando la procedura documentata, con il ruolo proprietario.
4. La migrazione `005` assegna a `percorso_app` solo i privilegi DML necessari.
5. Configurare `DATABASE_URL` del runtime con le credenziali di `percorso_app`, non con quelle del proprietario.

La migrazione `005` fallisce intenzionalmente se `percorso_app` non esiste o possiede attributi incompatibili con RLS. La migrazione `007` assegna i privilegi minimi di lettura/aggiornamento delle membership; la `008` protegge gli inviti con RLS e concede INSERT su utenti e membership per l'accettazione dei link monouso. Non modifica dati aziendali.

## Avvio del runtime PostgreSQL

Variabili richieste:

- `DATABASE_URL`: connessione del ruolo `percorso_app`.
- `APP_ORIGIN`: origine esatta dell'applicazione, ad esempio `https://app.example.it`. Più origini possono essere separate da virgole.
- `LOGIN_RATE_LIMIT_SECRET`: segreto casuale dedicato di almeno 32 caratteri.
- `PORT`: facoltativa, predefinita `3001`.
- `NODE_ENV=production`: abilita cookie `__Host-` e requisiti HTTPS.

Dopo la compilazione, avviare con `npm run start:postgres -w server`.

L'avvio esegue solo controlli in lettura: verifica il registro migrazioni e che il ruolo corrente non sia superuser, non abbia `BYPASSRLS`, non possieda le tabelle protette e disponga dei privilegi richiesti. Se una condizione manca, il processo si arresta. Non vengono applicate migrazioni automaticamente.

## Limiti

Questa configurazione dei privilegi non sostituisce i controlli applicativi: le query devono mantenere il filtro esplicito `organization_id` e usare `withTenantTransaction` per impostare il contesto RLS. Il ruolo applicativo non deve ricevere privilegi di gestione schema, creazione ruoli o modifica delle policy.
