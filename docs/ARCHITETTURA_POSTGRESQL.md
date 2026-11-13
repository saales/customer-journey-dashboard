# Migrazione PostgreSQL: stato e decisioni architetturali

## Stato verificato

Checkpoint precedente al commit `c4c927a`:
- CI PostgreSQL 16 superata su Node 20 e Node 22: installazione, test e build verdi (run [43424404401](https://github.com/saales/customer-journey-dashboard/actions/runs/43424404401)).
- È presente un runner di migrazioni versionate con checksum, advisory lock e transazione per file; il comando `db:migrate -- --check` esegue il confronto read-only tra file e storico registrato.
- Il planner e il runner hanno test unitari; gli SQL storici 001/002 sono verificati su PostgreSQL effimero.
- Non è stata eseguita alcuna ispezione su Neon e non è stato eseguito alcun DDL sul database remoto.


Il backend attualmente avviato da `server/src/index.ts` usa ancora SQLite:
- `openDb()` inizializza il database locale tramite `server/src/db.ts`;
- `createApp(db)` riceve un'istanza `better-sqlite3`;
- le route e le query in `server/src/app.ts` e `server/src/queries.ts` usano API sincrone SQLite (`prepare`, `get`, `all`, `run`, `transaction`);
- `server/src/postgres.ts` crea un pool `pg` e verifica la connessione, ma non è collegato alle route applicative;
- `server/src/check-postgres.ts` è soltanto un controllo di connettività.

Quindi la presenza di `pg` e di `DATABASE_URL` non equivale a una migrazione completata.

## Primo repository PostgreSQL tenant-scoped

Nel commit `d35d395` è stato aggiunto `server/src/postgres-customer-repository.ts`:
- implementa una lettura paginata dei clienti e dei relativi eventi;
- applica il filtro `organization_id` a conteggio, clienti ed eventi;
- imposta il contesto locale con `withTenantTransaction`;
- valida UUID, pagina, limite e offset sicuro;
- serializza gli ID PostgreSQL `BIGINT` come stringhe per non perdere precisione JavaScript.

Il repository è intenzionalmente **non collegato a Express**: l'organizzazione deve essere derivata da una sessione autenticata e da una membership attiva, che il runtime attuale non implementa. Non sono ancora presenti policy RLS nella baseline 001: questo componente applica quindi isolamento esplicito a livello query, non certifica una difesa RLS a livello database.

Il test `server/test/postgres-customer-repository.integration.test.ts` crea tabelle temporanee PostgreSQL con due organizzazioni e verifica separazione di conteggi, paginazione ed eventi, oltre al ripristino del contesto locale. CI PostgreSQL 16 verde su Node 20 e 22: run [43432840146](https://github.com/saales/customer-journey-dashboard/actions/runs/43432840146).

## Decisioni non negoziabili

1. **Non cambiare il runtime prima di avere test PostgreSQL reali.** L'attuale adapter SQLite resta disponibile finché il nuovo backend non supera la stessa suite funzionale.
2. **Nessuna scrittura automatica su Neon durante sviluppo o deploy.** Le migrazioni devono essere esplicite, versionate, transazionali dove possibile e applicate dopo backup e approvazione.
3. **Non ricreare una migrazione iniziale divergente.** Un riepilogo operativo storico riferisce una baseline Neon con checksum parziale `483595e...`, ma tale riferimento non è stato verificato sul database né ricondotto a un file SQL originale nel branch corrente. Va trattato come provenienza storica non confermata, non come prova dello stato attuale di Neon. Prima di aggiungere una baseline eseguibile occorre recuperare gli artefatti originali e confrontarli in sola lettura con il database di destinazione.
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
- Estendere il repository PostgreSQL a analytics, CRUD, import e fasi funnel; il solo listing clienti è già presente ma non è ancora collegato alle route.
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


## Risoluzione delle sessioni e membership (primo nucleo auth)

Nel commit `5070d3a` è stato aggiunto `server/src/postgres-session-resolver.ts`:
- genera token opachi casuali da 256 bit e calcola SHA-256 per la persistenza; il token grezzo non va memorizzato;
- risolve il contesto utente/organizzazione/ruolo tramite join tra `sessions`, `users`, `organizations` e `memberships`;
- accetta soltanto sessioni non scadute e con utente, organizzazione e membership attivi;
- ricava l'organizzazione esclusivamente dalla sessione server-side, non da parametri della richiesta.

Il test `server/test/postgres-session-resolver.integration.test.ts` copre token validi, scaduti e membership sospese su PostgreSQL effimero. CI run [43433194436](https://github.com/saales/customer-journey-dashboard/actions/runs/43433194436) ha completato `npm ci`, `npm test` e `npm run build` su Node 20 e 22.

Questo è un resolver isolato, **non un sistema di login completo**: password verification Argon2id, creazione/revoca sessioni, cookie HttpOnly/Secure/SameSite, protezione CSRF, rate limiting, middleware Express e autorizzazione per operazione non sono ancora collegati o implementati. Il runtime continua a usare SQLite.
