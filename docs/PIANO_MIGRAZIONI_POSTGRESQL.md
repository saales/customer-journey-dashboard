# Piano di ricostruzione e migrazione PostgreSQL

- **Stato:** piano operativo; non è DDL e non autorizza modifiche a Neon.
- **Branch di riferimento:** `recovery/checkpoint-12-postgres`
- **Baseline documentale aggiornata:** `02a19b585d9095196eef3c260c4d9c71a61b28a0`

## Obiettivo

Portare il prodotto da demo SQLite a SaaS B2B multi-tenant senza perdere dati, inventare una baseline incompatibile o confondere la presenza di un pool PostgreSQL con un backend migrato.

Questo piano separa quattro fonti che non sono intercambiabili:

1. **Codice runtime attuale:** descrive il comportamento realmente eseguito oggi.
2. **Contratto dati PostgreSQL:** descrive requisiti progettuali, non uno schema già applicato.
3. **Storico del database di destinazione:** prova quali migrazioni siano già state applicate e con quali checksum.
4. **Migrazioni versionate:** devono essere ricostruite dagli SQL originali e validate su PostgreSQL effimero prima di qualsiasi proposta di applicazione.

## Rilievi verificati nel codice SQLite

Il file `server/src/db.ts` definisce attualmente:

| Tabella | Schema SQLite verificato | Differenza/rischio per il contratto SaaS |
|---|---|---|
| `customers` | `id INTEGER PRIMARY KEY`, `channel TEXT`, `created_at TEXT` | Non contiene `organization_id` né `external_id`; il tipo/strategia ID PostgreSQL va deciso senza rompere API e import |
| `events` | ID autoincrementale, `customer_id` FK, `stage TEXT`, `occurred_at TEXT` | Nessuno scope tenant; nessuna FK verso `funnel_stages`; la FK cliente attuale non è composita |
| `import_batches` | ID autoincrementale, `fingerprint TEXT UNIQUE`, nome file, conteggi, timestamp | Fingerprint globale nel demo; il contratto richiede unicità per tenant |
| `funnel_stages` | `id TEXT PRIMARY KEY`, label, position UNIQUE, flag attivi/sistema | Nessuno scope tenant; gli ID delle fasi sono stringhe e la posizione è globale |
 
Gli indici SQLite correnti sono globali e non iniziano con `organization_id`. Le fasi predefinite vengono inserite da `initializeFunnelStages` quando si inizializza il database.

Il file `server/src/app.ts` usa direttamente l'API sincrona SQLite. La validazione import raggruppa i clienti usando `externalId`, ma questo campo non è persistito nella tabella `customers` mostrata nello schema: non va quindi assunto che il contratto PostgreSQL proposto sia una semplice trasposizione uno-a-uno.

## Matrice delle decisioni ancora aperte

| Area | Evidenza disponibile | Decisione necessaria prima del DDL |
|---|---|---|
| Baseline Neon 001 | È noto un checksum storico parziale `483595e...`, ma non il file SQL esatto nel branch | Recuperare SQL originale, checksum completo, versione e ordine |
| Migrazione 002 sessioni | Il riepilogo storico riferisce l'aggiunta di `sessions.organization_id`; il file originale non è disponibile | Recuperare SQL e checksum; verificare nullable/FK/indice effettivi |
| Identificativo cliente | SQLite usa intero; il contratto propone BIGINT identity | Definire compatibilità API, import, ordinamento e mapping ID |
| `external_id` | Usato dal validatore import, assente dalla tabella SQLite corrente | Stabilire persistenza, normalizzazione e policy di deduplicazione per tenant |
| Funnel stages | SQLite usa ID testuali e posizione globale | Confermare se gli ID restano testuali; definire seed per organizzazione e unicità tenant-scoped |
| Eventi | Stage memorizzato come testo senza FK alla tabella fasi | Decidere se introdurre FK a fasi, e come gestire eventi relativi a fasi disattivate/rinominate |
| Import batches | Fingerprint globale nello schema demo | Definire fingerprint canonico e vincolo univoco per organizzazione |
| Timestamp | Date SQLite sono stringhe | Definire conversione, timezone, precisione e compatibilità con le API |
| Identità e membership | Il contratto è progettuale; il runtime attuale non le implementa | Confermare schema storico, policy email, ruoli e sessioni prima dei repository |
| RLS | ADR propone RLS come difesa aggiuntiva | Decidere policy, ruolo runtime e strategia migrazioni separata; testare con ruolo reale non privilegiato |

## Gate obbligatori

### Gate 0 — Provenienza della baseline

Non scrivere né rinominare una migrazione storica sulla base di una ricostruzione per supposizione.

Evidenze da raccogliere:
- SQL integrale delle migrazioni 001 e 002 già applicate;
- checksum SHA-256 completo e identico a quello registrato nel database;
- tabella/versione delle migrazioni e relativi timestamp;
- schema effettivo (tabelle, colonne, tipi, default, vincoli, indici, policy RLS e proprietari);
- conferma che il dump/schema ispezionato sia riferito al database corretto.

Se l'SQL originale non è recuperabile, il lavoro si ferma alla documentazione e a un piano di riconciliazione non distruttivo. Non creare una baseline sostitutiva e non marcare migrazioni come applicate per aggirare il controllo.

### Gate 1 — Contratto canonico

Dopo il Gate 0, aggiornare il contratto con:
- tipi e nomi canonici confrontati con lo schema reale;
- PK, unique constraint e FK composite tenant-scoped;
- comportamento per organizzazioni appena create e demo seed esplicito;
- policy per email, inviti, sessioni, revoche e membership;
- conversioni SQLite → PostgreSQL e trattamento dei dati non conformi;
- compatibilità API per ID numerici, date e identificativi esterni.

Ogni differenza deve essere classificata come compatibilità, trasformazione dati o breaking change. Nessuna modifica silenziosa.

### Gate 2 — Migrazioni verificabili su PostgreSQL effimero

- Versionare le migrazioni nuove senza alterare quelle già applicate.
- Applicarle in ordine su un PostgreSQL usa-e-getta vuoto.
- Verificare anche il percorso di upgrade partendo da una copia ripristinata dello schema storico.
- Testare vincoli, indici, transazioni, rollback, seed esplicito e organizzazioni vuote.
- Aggiungere un controllo che fallisca in caso di checksum divergente.
- Mantenere CI senza credenziali Neon e senza DDL sul database condiviso.

### Gate 3 — Repository e parità funzionale

- Introdurre un'interfaccia repository asincrona; non tentare di sostituire semplicemente `Db` con `Pool`.
- Passare un contesto tenant derivato dalla sessione verificata a ogni operazione tenant-scoped.
- Usare un singolo client PostgreSQL per ogni transazione che imposta il contesto RLS.
- Testare la parità dei risultati SQLite/PostgreSQL su dataset deterministici.
- Testare accesso cross-tenant negativo per letture, conteggi, filtri, mutazioni, import ed export.

### Gate 4 — Identità, autorizzazione e isolamento

Prima di esporre il runtime SaaS:
- autenticazione e sessioni server-side con hash dei token;
- membership attiva e ruolo risolti lato server;
- autorizzazione per ogni route, non soltanto nell'interfaccia;
- FK composite e query con filtro esplicito tenant;
- RLS, se adottata, con ruolo runtime non owner, non superuser e senza `BYPASSRLS`;
- test di riuso del pool A → B, revoca e scadenza sessioni, inviti e rollback.

### Gate 5 — Cutover controllato

- backup e restore realmente provati;
- staging migrato e smoke test documentati;
- confronto conteggi e risultati analytics;
- procedura di rollback che non richieda downgrade distruttivi;
- health check collegato al database effettivamente usato dal runtime;
- approvazione esplicita prima di ogni operazione sul database condiviso.

## Regole di sicurezza operativa

- Questo piano non contiene comandi da eseguire su Neon.
- Non usare credenziali di produzione nella CI.
- Non inserire segreti o connection string nel repository o nei log.
- Non applicare automaticamente migrazioni all'avvio del server.
- Non caricare dati demo in produzione e non popolare automaticamente nuove organizzazioni.
- Non dichiarare il prodotto SaaS-ready finché runtime, autenticazione, autorizzazione, isolamento e test non sono effettivamente implementati.

## Prossima attività tecnica consentita

Recuperare e confrontare la baseline storica e lo schema effettivo in modalità sola lettura, oppure, se tali artefatti non sono disponibili, proseguire con test e refactoring isolati dal database. Fino ad allora, le migrazioni eseguibili restano bloccate.
