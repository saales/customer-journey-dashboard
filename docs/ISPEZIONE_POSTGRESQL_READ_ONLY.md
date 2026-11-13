# Ispezione PostgreSQL in sola lettura

Il comando `db:inspect` produce un inventario tecnico dei metadati PostgreSQL utili alla verifica preliminare dello schema e della configurazione RLS.

## Esecuzione

Prerequisiti:
- Node.js e dipendenze del workspace `server` installate;
- `DATABASE_URL` impostata nell'ambiente, oppure definita in `.env.local` o `.env` nella root del repository;
- un ruolo PostgreSQL autorizzato a leggere i cataloghi necessari.

Dalla root del repository:

```bash
npm run db:inspect -w server
```

Il comando apre una connessione tramite il pool PostgreSQL, avvia una transazione `BEGIN READ ONLY`, legge i metadati e termina con `ROLLBACK`. Non esegue migrazioni e non scrive dati. Se il rollback fallisce, la connessione viene scartata anziché riutilizzata.

Non inserire credenziali in argomenti di comando, log, ticket o output condivisi. Usare il secret manager dell'ambiente o un file locale escluso dal versionamento. Non eseguire il comando contro un database aziendale senza autorizzazione esplicita e senza aver verificato la destinazione della connessione.

## Contenuto del report

Il report JSON comprende:
- identità del database, ruolo corrente, schema corrente e versione PostgreSQL;
- tabelle ordinarie e partizionate non appartenenti agli schemi di sistema;
- colonne, tipi, nullability e default;
- vincoli e indici;
- policy RLS visibili al ruolo che esegue l'ispezione;
- per ogni tabella, flag `row_level_security_enabled` e `row_level_security_forced`;
- capacità del ruolo corrente, incluse le proprietà superuser e BYPASSRLS;
- sola indicazione dell'esistenza di `public.schema_migrations`.

## Limiti da non confondere con una validazione

Questo strumento è un inventario, non un audit completo né una prova di isolamento multi-tenant:
- non legge righe applicative;
- non legge il contenuto di `schema_migrations`, checksum, versioni o stato delle singole migrazioni;
- non confronta lo schema con il contratto dati o con una baseline storica;
- non verifica i filtri tenant nelle query applicative, autenticazione, autorizzazioni API o flussi di sessione;
- le policy riportate sono quelle visibili attraverso `pg_catalog.pg_policies` al ruolo utilizzato;
- i flag RLS descrivono la configurazione delle tabelle, ma non dimostrano da soli che ogni percorso applicativo sia isolato correttamente.

L'assenza di policy, RLS disabilitata, RLS non forzata o un ruolo superuser/BYPASSRLS richiedono analisi specifica. Anche con RLS attiva, proprietari di tabelle e ruoli privilegiati possono avere comportamenti che non corrispondono al normale ruolo applicativo.

## Stato nel progetto

L'ispezione è stata aggiunta come strumento diagnostico e i test unitari verificano la transazione read-only, il rollback e il rilascio sicuro della connessione. Finché non viene eseguita con un accesso autorizzato, il report non contiene informazioni verificate sul database Neon effettivo. Nessuna migrazione viene applicata automaticamente all'avvio del server.
