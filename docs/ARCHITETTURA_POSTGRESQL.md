# Migrazione PostgreSQL: stato e decisioni architetturali

## Stato verificato

Il backend attualmente avviato da `server/src/index.ts` usa ancora SQLite:
- `openDb()` inizializza il database locale tramite `server/src/db.ts`;
- `createApp(db)` riceve un'istanza `better-sqlite3`;
- le route e le query in `server/src/app.ts` e `server/src/queries.ts` usano API sincrone SQLite (`prepare`, `get`, `all`, `run`, `transaction`);
- `server/src/postgres.ts` crea un pool `pg` e verifica la connessione, ma non è collegato alle route applicative;
- `server/src/check-postgres.ts` è soltanto un controllo di connettività.

Quindi la presenza di `pg` e di `DATABASE_URL` non equivale a una migrazione completata.

## Decisioni non negoziabili

1. **Non cambiare il runtime prima di avere test PostgreSQL reali.** L'attuale adapter SQLite resta disponibile finché il nuovo backend non supera la stessa suite funzionale.
2. **Nessuna scrittura automatica su Neon durante sviluppo o deploy.** Le migrazioni devono essere esplicite, versionate, transazionali dove possibile e applicate dopo backup e approvazione.
3. **Non ricreare una migrazione iniziale divergente.** Il database Neon è stato precedentemente inizializzato con una baseline il cui checksum registrato è `483595e...` (riferimento operativo del checkpoint). I file SQL corrispondenti non sono presenti nel branch corrente. Prima di aggiungere una baseline eseguibile occorre recuperare e confrontare il contenuto esatto già applicato.
4. **Tenant isolation dal modello dati in su.** Ogni tabella con dati aziendali deve includere `organization_id`; le relazioni tra record devono impedire collegamenti cross-tenant con foreign key composite; ogni query e mutazione deve ricevere l'organizzazione dalla sessione verificata, mai dal body o dalla query string.
5. **Nuove organizzazioni vuote.** I dati sintetici possono essere caricati soltanto nell'organizzazione Demo isolata, con comando esplicito e guardie che impediscano l'esecuzione in produzione.
6. **Nessun segreto nel repository.** `DATABASE_URL` e le credenziali restano variabili d'ambiente del deploy; non vanno richieste o inserite in file versionati.

## Sequenza di migrazione

### Fase A — baseline e test
- Recuperare gli SQL esatti già applicati a Neon e verificare checksum e ordine delle migrazioni.
- Aggiungere PostgreSQL come servizio effimero nella CI.
- Scrivere test d'integrazione su schema vuoto e schema migrato, senza usare Neon.
- Verificare vincoli, indici, tipi, transazioni e comportamento con organizzazione vuota.

### Fase B — repository PostgreSQL
- Separare accesso ai dati da Express con un'interfaccia repository asincrona.
- Implementare repository PostgreSQL per analytics, clienti, eventi, import e fasi funnel.
- Aggiungere test di parità tra risultati SQLite e PostgreSQL sui dataset di test.
- Evitare un semplice cambio di tipo da `Db` a `Pool`: le API sincrone e le transazioni SQLite non sono compatibili con `pg`.

### Fase C — identità e multi-tenancy
- Implementare organizzazioni, utenti, membership, inviti, sessioni e audit log.
- Derivare `organization_id` esclusivamente dalla sessione autenticata.
- Applicare autorizzazioni lato server per ogni route e operazione.
- Testare esplicitamente che un utente di un tenant non possa leggere, modificare, importare o cancellare dati di un altro tenant.

### Fase D — cutover
- Eseguire backup verificato e prova di restore.
- Applicare migrazioni su staging e verificare smoke test.
- Passare il runtime a PostgreSQL con rollback documentato.
- Solo dopo le verifiche, dismettere SQLite e aggiornare documentazione e configurazione di deploy.

## Criteri di completamento

La migrazione non può essere dichiarata conclusa finché:
- l'applicazione in esecuzione usa PostgreSQL per tutte le operazioni applicative;
- CI esegue test d'integrazione PostgreSQL su Node 20 e 22;
- i test di isolamento tenant e autorizzazione passano;
- migrazioni, backup e restore sono verificati;
- health check controlla il database effettivamente usato dal runtime;
- il deploy staging/produzione è stato verificato senza seed automatico.

## Limiti dello stato attuale

Questo documento registra la situazione del branch e le condizioni per una migrazione sicura. Non afferma che autenticazione, multi-tenancy o PostgreSQL runtime siano già implementati. Non esegue query né modifiche sul database Neon.
