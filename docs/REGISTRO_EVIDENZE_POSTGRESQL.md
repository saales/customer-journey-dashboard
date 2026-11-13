# Registro delle evidenze PostgreSQL

**Aggiornato:** 2026-11-13  
**Branch:** `recovery/checkpoint-12-postgres`  
**Ultima CI completata con esito positivo:** commit `5df2205d3a6c6391710ca522006116c7d561a55f`, run [43447644855](https://github.com/saales/customer-journey-dashboard/actions/runs/43447644855), Node 20 e 22. Le modifiche successive includono correzioni di validazione date, limiti dei body JSON e timeout di inattività delle sessioni; la CI per il ramo aggiornato deve essere completata prima di considerarle validate.  
**PR:** [#1](https://github.com/saales/customer-journey-dashboard/pull/1), aperta in bozza, non merged.

Questo registro distingue il codice effettivamente presente nel branch, gli artefatti recuperati dallo ZIP checkpoint 12 e lo stato remoto non verificato. Non certifica lo stato del database Neon.

## Aggiornamento del prodotto e della documentazione — 2026-11-13

| Affermazione | Evidenza | Stato |
|---|---|---|
| Il nome e le etichette principali dell'interfaccia sono stati uniformati in italiano | `client/src/components/AppLayout.tsx`, `Segmentation.tsx`, `FunnelSettings.tsx`, `DataImport.tsx`, `Comparisons.tsx`, `CustomerManagement.tsx` | Modifiche presenti nel ramo; nuova CI completa da eseguire |
| I metadati dei file Excel/PDF e il nome del foglio sono in italiano | `client/src/components/ExportButton.tsx` | Modifica presente nel ramo; nuova CI completa da eseguire |
| La presentazione principale del progetto è stata riscritta in italiano e dichiara esplicitamente i limiti attuali | `README.md` | Verificato nel ramo |
| Il servizio di autenticazione PostgreSQL verifica password scrypt e crea sessioni tramite il repository dedicato | `server/src/postgres-authentication.ts`, `server/src/password-hashing.ts`, `server/src/postgres-session-repository.ts`, `server/src/postgres-auth-routes.ts`, `server/src/postgres-app.ts` | Collegato alle route del runtime PostgreSQL separato; integrazione completa del browser con tale runtime ancora da verificare |
| La richiesta di modifica è stata rinominata e aggiornata per riportare lo stato effettivo e i blocchi ancora aperti | PR #1 | Verificato; resta in bozza e non unita |

## Correzioni sicurezza e validazione — aggiornamento 2026-11-13

| Intervento | Evidenza | Stato |
|---|---|---|
| Validazione date ISO reale nel formato YYYY-MM-DD per i filtri analytics | `isValidPostgresDate` in `server/src/postgres-app.ts` e test in `server/test/postgres-app.test.ts` | Modifica presente; CI aggiornata da completare |
| Limite JSON ordinario di 1 MiB e limite dedicato di 12 MiB per importazione | Middleware body parser in `server/src/postgres-app.ts` | Modifica presente; CI aggiornata da completare |
| Risposte controllate 400/413 per JSON malformato e body troppo grande | Error handler del runtime PostgreSQL e test HTTP | Modifica presente; CI aggiornata da completare |
| Timeout inattività sessioni di 30 minuti oltre alla scadenza assoluta | `last_used_at` aggiornato da `resolvePostgresSession`; migrazione `006_session_idle_timeout.sql` | Modifica presente; integrazione PostgreSQL e CI aggiornate da completare |
| Privilegio di aggiornamento limitato alla sola colonna `sessions.last_used_at` | Migrazione 006 e controllo `has_column_privilege` nel preflight runtime | Modifica presente; test migrazione aggiunto |
| Test di regressione per sessione attiva, inattività, validazione date e dimensione richieste | `server/test/postgres-session-resolver.integration.test.ts`, `server/test/postgres-app.test.ts`, `server/test/postgres-migrations.integration.test.ts` | Presenti nel ramo; CI aggiornata da completare |

## Evidenze verificate nel branch Git

| Affermazione | Evidenza | Stato |
|---|---|---|
| Il runtime applicativo del branch usa ancora SQLite | `server/src/index.ts`, `server/src/app.ts`, `server/src/db.ts` | Verificato |
| Un repository PostgreSQL read-only per listing clienti esiste ma non è collegato alle route | `server/src/postgres-customer-repository.ts`; Express usa ancora SQLite | Verificato al commit `d35d395` |
| È presente un'ispezione read-only dei cataloghi PostgreSQL | `server/src/postgres-schema-inspection.ts` | Verificato |
| L'ispezione usa `BEGIN READ ONLY`, legge metadati e cataloghi, fa `ROLLBACK` e rilascia il client | Implementazione di `inspectPostgresSchema` | Verificato nel codice |
| L'ispezione non legge righe applicative | Query su database identity, cataloghi, `information_schema`, ruolo e presenza di `schema_migrations` | Verificato nel codice |
| Il report filtra tabelle, colonne, vincoli, indici e policy in base al privilegio SELECT | `has_table_privilege(..., 'SELECT')` e test `private_probe` | Verificato in CI |
| Il test d'integrazione usa un ruolo `NOLOGIN`, non superuser e senza `BYPASSRLS` | `server/test/postgres.integration.test.ts` | Verificato in CI run [43418128323](https://github.com/saales/customer-journey-dashboard/actions/runs/43418128323), Node 20 e 22 |
| Test e build sul checkpoint codice precedente sono passati su Node 20 e 22 | CI run [43424404401](https://github.com/saales/customer-journey-dashboard/actions/runs/43424404401): `npm ci`, `npm test`, `npm run build` tutti success su entrambi i runtime | Verificato al commit `c4c927a` |
| Repository clienti PostgreSQL e test d'isolamento a livello query passano su PostgreSQL 16 | `server/src/postgres-customer-repository.ts`, `server/test/postgres-customer-repository.integration.test.ts`; CI run [43432840146](https://github.com/saales/customer-journey-dashboard/actions/runs/43432840146) | Verificato al commit `d35d395`, Node 20/22 |
| Resolver sessioni verifica token hash, scadenza e membership attiva su PostgreSQL | `server/src/postgres-session-resolver.ts`, `server/test/postgres-session-resolver.integration.test.ts`; CI run [43433194436](https://github.com/saales/customer-journey-dashboard/actions/runs/43433194436) | Verificato al commit `5070d3a`, Node 20/22 |
| Il runner PostgreSQL e il preflight read-only sono presenti nel branch | `server/src/postgres-migrations.ts`, `server/src/migrate-postgres.ts`, script `db:migrate -- --check`; test unitari inclusi nella CI | Verificato nel branch |
| PR #1 resta aperta in bozza, non merged; `main` invariata | PR #1 e confronto branch | Verificato al 2026-11-13 |

## Artefatti recuperati dallo ZIP checkpoint 12

Lo ZIP caricato il 2026-11-13 contiene gli SQL originali e una versione più avanzata del backend PostgreSQL. I due SQL sono stati copiati senza modifiche in `server/migrations/` su questo branch.

| File | SHA-256 del contenuto | Riscontro |
|---|---|---|
| `server/migrations/001_initial_schema.sql` | `483595e49acac3dd534ecef096d4735ef9527fbaaa73ef2bff38e904db2dc162` | Coincide integralmente con il prefisso storico noto `483595e...` |
| `server/migrations/002_session_organization.sql` | `3d8b40cddff8f4e704679b164d9dfec1dc42e329b56ee79cd45520ff4a30e188` | SQL recuperato; checksum storico registrato nel database non disponibile |

La migrazione 001 crea organizzazioni, utenti, membership, inviti, sessioni, fasi funnel, clienti, eventi, import batch e audit log. Prevede FK composite tenant-scoped per eventi→clienti e eventi→fasi. **Non definisce policy RLS** e non aggiunge `customers.external_id`.

La migrazione 002 aggiunge `sessions.organization_id` come colonna nullable con FK verso `organizations` e indice su organizzazione/scadenza. Non esegue backfill delle sessioni preesistenti e non rende la colonna NOT NULL.

Lo ZIP contiene inoltre `migrate-postgres.ts`, `auth.ts`, `queries-postgres.ts`, `bootstrap-admin.ts`, `seed-postgres.ts` e una versione PostgreSQL di `app.ts`. Questi file sono **artefatti recuperati ma non ancora integrati né validati** nel branch Git corrente. La loro presenza nello ZIP non prova che siano stati applicati o distribuiti.

## Verifiche mancanti sulla baseline remota

- Stato effettivo di Neon, schema, proprietari, privilegi, RLS e policy: **non verificati**.
- Presenza e contenuto della tabella `schema_migrations`, versioni, timestamp e checksum memorizzati: **non verificati**.
- Applicazione effettiva della migrazione 001 e della 002: **non confermata**.
- La documentazione inclusa nello ZIP è internamente non uniforme sullo stato della 002: alcuni passaggi la descrivono come migrazione da applicare, altri richiedono di verificarla sul target. Non assumere uno stato.
- Il runner migrazioni recuperato dallo ZIP è stato sostituito nel branch da un'implementazione versionata e testata; il runner corrente applica ogni migrazione in transazione, serializza con advisory lock e verifica checksum. Il comando `db:migrate -- --check` esegue un preflight read-only dello storico, ma non è stato eseguito contro Neon.
- L'installazione dipendenze dello ZIP è stata interrotta dall'ambiente; `vitest` non era disponibile e la build ha restituito errori di tipi mancanti dovuti all'installazione incompleta. Non è una validazione positiva né una prova di difetto del codice.
- Autenticazione, sessioni, inviti e autorizzazione tenant runtime: non implementati nel branch corrente.
- Repository PostgreSQL e API multi-tenant end-to-end: non implementati nel branch corrente.
- Prova di upgrade su PostgreSQL effimero e da copia storica: non ancora eseguita.

## Rilievi tecnici da preservare

1. La migrazione storica 001 non abilita RLS; la migrazione additiva 003 abilita RLS sulle tabelle operative tenant-scoped. Il runtime Express SQLite non usa ancora PostgreSQL, e le policy non sostituiscono filtri espliciti e autorizzazione applicativa.
2. La migrazione storica 001 non persiste `external_id`; la migrazione 003 lo aggiunge e assegna `legacy:<id>` ai record storici. Il contratto dei nuovi import deve usare l'ID sorgente e prevenire collisioni.
3. Le migrazioni 002 e 003 lasciano nullable `sessions.organization_id` per non inventare l'organizzazione delle sessioni legacy. La FK membership `NOT VALID` protegge i nuovi riferimenti valorizzati; il resolver rifiuta sessioni senza organizzazione.
4. Lo ZIP contiene solo test auth unitari e test frontend/CSV; non contiene test d'integrazione delle API PostgreSQL, query analytics, migrazioni o isolamento cross-tenant.

## Audit preliminare del codice recuperato nello ZIP

Questa revisione è statica: il codice ZIP non è ancora integrato nel branch e non è stato possibile completare un'installazione locale pulita delle dipendenze.

- Il backend ZIP contiene auth, query analytics PostgreSQL, CRUD clienti/fasi, import, bootstrap admin, seed Demo e runner migrazioni.
- Il client del branch corrente usa il contratto paginazione `{ data, pagination: { page, limit, total, totalPages } }`; il server nello ZIP restituisce `{ items, total, page, pageSize, totalPages }`. L'integrazione deve preservare/adattare il contratto del branch, non ripristinare alla cieca il client ZIP.
- Le query PostgreSQL esaminate applicano esplicitamente `organization_id`, ma la migrazione 001 non abilita RLS e non esistono test d'integrazione cross-tenant per le route/query ZIP.
- `seed-postgres.ts` richiede `ALLOW_DEMO_SEED=true`, ma non contiene un blocco esplicito per `NODE_ENV=production`: va corretto prima di usare il comando in ambienti reali.
- La creazione di una fase aggiorna `position = position + 1` sotto un vincolo UNIQUE immediato; il possibile conflitto tra posizioni va coperto da un test PostgreSQL e corretto con uno spostamento a due fasi.
- Alcuni catch del backend ZIP eseguono rollback ma rilasciano comunque il client senza distruggerlo se il rollback fallisce; usare il pattern già presente nel branch in `tenant-transaction.ts`.
- Il runner ZIP in modalità `--check` esegue il DDL mancante dentro una transazione e poi fa rollback: non è una semplice ispezione read-only dei cataloghi e non va eseguito su Neon come sostituto dell'ispezione.
- Il seed Demo e il bootstrap non hanno test d'integrazione; login, query analytics, CRUD, import, migrazioni e isolamento tenant non hanno una suite PostgreSQL completa.
- `README.md` e `docs/ARCHITETTURA.md` nello ZIP descrivono ancora SQLite e auto-seed, quindi non rappresentano il comportamento del backend PostgreSQL incluso nello stesso archivio.
- La revisione locale del ZIP non ha completato `npm ci`: l'ambiente ha interrotto il processo e le dipendenze risultavano parziali. I conseguenti errori locali di `vitest`/TypeScript non sono attribuibili con certezza al sorgente. La CI del branch, invece, ha superato test e build.

## Prossimi passi sicuri

1. Confrontare gli SQL recuperati con la struttura e il registro migrazioni reali tramite ispezione autorizzata in sola lettura; nessuna modifica a Neon.
2. Eseguire le migrazioni su PostgreSQL effimero e aggiungere test d'integrazione prima di integrare il backend ZIP.
3. Risolvere le decisioni su `external_id`, RLS, sessioni legacy, ruoli e inviti.
4. Solo dopo, integrare progressivamente auth, repository e API PostgreSQL nel branch e mantenere CI verde.

## Stato al checkpoint `d35d395`

- La CI PostgreSQL 16 è verde su Node 20 e Node 22: `npm ci`, `npm test` e `npm run build` sono tutti riusciti.
- La suite include test unitari del planner/runner migrazioni e test d'integrazione su PostgreSQL effimero per gli SQL storici, i vincoli, le transazioni tenant e il repository clienti con due organizzazioni isolate.
- Il planner read-only non è ancora stato eseguito contro il database Neon; lo schema remoto e lo storico effettivo restano non verificati.
- Il runtime applicativo resta SQLite. Esiste un solo repository PostgreSQL read-only per il listing clienti, non collegato alle route; autenticazione runtime, autorizzazione membership, policy RLS e isolamento tenant end-to-end non sono ancora implementati.

**Regola operativa:** gli SQL storici recuperati non vanno riscritti o rinominati. Nessuna migrazione e nessuna modifica a Neon senza autorizzazione esplicita e confronto read-only della baseline.


## Stato al checkpoint `d35d395`

- Aggiunto `server/src/postgres-customer-repository.ts`: listing read-only paginato, conteggio e caricamento eventi con predicati espliciti su `organization_id`; ID BIGINT restituiti come stringhe.
- Aggiunto `server/test/postgres-customer-repository.integration.test.ts`: fixture temporanee PostgreSQL con due tenant; verifica che pagine, conteggi ed eventi non attraversino i confini tenant e che il contesto `SET LOCAL` non sopravviva alla transazione.
- CI PostgreSQL 16 verde su Node 20 e 22, run [43432840146](https://github.com/saales/customer-journey-dashboard/actions/runs/43432840146): `npm ci`, `npm test`, `npm run build` riusciti su entrambi.
- Il repository non è collegato all'API perché manca ancora un contesto utente/membership autenticato. Le route continuano a usare SQLite.
- Neon non è stato ispezionato né modificato; nessun DDL remoto eseguito.


## Stato al checkpoint `5070d3a`

- Aggiunto resolver sessioni PostgreSQL: token opaco 256-bit, SHA-256 persistito, join con utente/organizzazione/membership e rifiuto di sessioni scadute o membership sospese.
- Aggiunti test d'integrazione su PostgreSQL effimero per sessione valida, sessione scaduta e membership sospesa.
- CI run [43433194436](https://github.com/saales/customer-journey-dashboard/actions/runs/43433194436): `npm ci`, `npm test`, `npm run build` completati con successo su Node 20 e 22.
- Il resolver non è collegato a Express: login/password hashing, cookie, CSRF, rate limiting, creazione/revoca sessioni e middleware restano da implementare.
- Il runtime usa ancora SQLite; nessuna route API è passata a PostgreSQL.
- Neon non è stato ispezionato né modificato; nessun DDL remoto eseguito.

## Stato al checkpoint PostgreSQL-first `f957e25`

- Aggiunta `server/migrations/003_saas_tenant_hardening.sql`, registrata nel runner: colonna `customers.external_id` obbligatoria con backfill tecnico `legacy:<id>`, indice univoco per organizzazione, FK `sessions(organization_id,user_id)` → `memberships(organization_id,user_id)` `NOT VALID`, RLS abilitata su customers, events, funnel_stages, import_batches e audit_logs.
- Il backfill `legacy:<id>` è un identificativo tecnico di compatibilità, non recupera gli ID esterni originari. I nuovi flussi d'import devono scrivere l'ID sorgente e gestire possibili collisioni con il prefisso legacy.
- `withTenantTransaction` imposta `app.current_organization_id`, lo stesso parametro letto dalle policy RLS. Le query devono comunque applicare filtri espliciti tenant-scoped; il ruolo runtime non deve essere proprietario né avere `BYPASSRLS`.
- Il test d'integrazione migrazioni applica 001-003 su schema isolato, verifica il backfill, RLS, FK non validata e isolamento lettura tra due tenant con un ruolo non proprietario.
- La CI del commit precedente `0e6e4d5`, run [43435560705](https://github.com/saales/customer-journey-dashboard/actions/runs/43435560705), è fallita su due asserzioni obsolete in `server/test/postgres.integration.test.ts` che leggevano `app.organization_id`. Il codice impostava correttamente `app.current_organization_id`; il test è stato corretto nel commit `f957e25`. La nuova CI run [43436719524](https://github.com/saales/customer-journey-dashboard/actions/runs/43436719524) è in esecuzione e non è ancora prova di successo.
- La PR #1 resta aperta in bozza. `main` non è stata modificata. Neon non è stato ispezionato né modificato; nessun DDL remoto eseguito.
- Il runtime Express resta SQLite e le API non sono ancora autenticate/tenant-scoped; la migrazione 003 da sola non rende il prodotto pronto per clienti reali.


## Stato runtime HTTP PostgreSQL — aggiornamento 2026-11-13

| Affermazione | Evidenza | Stato |
|---|---|---|
| Runtime Express PostgreSQL separato con rotte clienti/funnel e middleware sessione/permessi | `server/src/postgres-app.ts`, `server/src/postgres-auth-routes.ts` | Codice presente nel branch; CI del commit finale da verificare |
| Il runtime non si avvia se le migrazioni sono mancanti o con checksum divergente | `server/src/postgres-server.ts`, `planPostgresMigrations` | Preflight read-only nel codice |
| Il ruolo applicativo non può essere owner, superuser o BYPASSRLS e deve avere privilegi minimi | `server/src/postgres-runtime-preflight.ts`, migrazione `005_runtime_role_grants.sql` | Implementato; test automatici aggiunti |
| I privilegi sono separati dal ruolo proprietario e concessi esplicitamente | `docs/CONFIGURAZIONE_RUOLI_POSTGRESQL.md`, migrazione 005 | Non applicato a Neon; richiede creazione preventiva del ruolo da parte DBA |
| Il runtime PostgreSQL non applica migrazioni automaticamente | `server/src/postgres-server.ts` | Verificato nel codice |
| Il runtime SQLite resta l'entrypoint predefinito e il client non è ancora migrato | `server/src/index.ts`, `client/src/api.ts` | Verificato |
| Neon non è stato ispezionato né modificato | Nessuna operazione remota eseguita | Confermato |


## Gestione clienti PostgreSQL — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Creazione cliente compatibile con il modulo web: la visita iniziale viene generata lato server e l'identificativo esterno manuale è assegnato se assente | `server/src/postgres-app.ts`, `postgres-customer-repository.ts` | Implementata |
| Modifica cliente e sostituzione atomica degli eventi del percorso | `updatePostgresCustomer` e test d'integrazione | Implementata |
| Eliminazione cliente con filtro esplicito organizzazione e cancellazione eventi tramite vincolo FK | `deletePostgresCustomer`, migrazione 005 | Implementata |
| ID BIGINT trattato come stringa nel client per evitare perdita di precisione JavaScript | `client/src/api.ts`, `CustomerManagement.tsx` | Adeguato |
| Privilegi DB per aggiornare/eliminare clienti ed eventi | migrazione `005_runtime_role_grants.sql`, preflight runtime | Inclusi; non applicati al database remoto |


## Gestione funnel PostgreSQL — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Creazione fasi personalizzate con ID stabile, ordine finale e unicità del nome nel tenant | `createPostgresFunnelStage` e test d'integrazione | Implementata |
| Riordino completo con blocco delle fasi Visita e Cliente agli estremi | `reorderPostgresFunnelStages` e test di regressione | Implementato |
| Il client può creare, rinominare, attivare/disattivare e riordinare le fasi | `FunnelSettings.tsx`, API PostgreSQL | Copertura server presente; collegamento browser ancora da collaudare con sessione reale |


## Accesso browser — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Controllo sessione prima di montare le schermate applicative | `client/src/components/AuthGate.tsx`, `main.tsx` | Implementato |
| Modulo di accesso con email, password e codice organizzazione | `AuthGate.tsx` | Implementato |
| Cookie di sessione non leggibile da JavaScript; nessun token in localStorage | Auth router server + AuthGate browser | Implementato nel codice |
| Uscita con revoca server-side e cancellazione cookie | `POST /api/auth/logout`, `AuthGate.tsx` | Implementato nel codice |
| Modalità demo SQLite limitata all'ambiente di sviluppo quando la route auth non esiste | `AuthGate.tsx` | Implementata; non attiva in produzione |
| Test browser di login, controllo sessione e logout | `client/src/components/AuthGate.test.tsx` | Aggiunti; CI del commit finale da verificare |


## Segmentazione PostgreSQL — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Segmentazione per canale, fase raggiunta, mese e combinazione canale/fase | `getPostgresSegments` | Implementata |
| Classificazione distinta delle fasi disattivate | `postgres-segmentation-repository.ts` | Implementata |
| Dettaglio clienti per segmento con ID BIGINT serializzato come stringa | `getPostgresSegmentCustomers`, contratto client | Implementato |
| Filtro tenant e date in ogni query; contesto RLS nella transazione | repository + test con due organizzazioni | Test d'integrazione aggiunti |
| API di lettura protette dal permesso analytics:read | `GET /api/segments`, `GET /api/segments/customers` | Implementate |


## Importazione PostgreSQL — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Validazione server-side di canali, date, fasi attive, duplicati e cronologia | `validateRows` in `postgres-import-repository.ts` | Implementata |
| Raggruppamento righe per identificativo esterno e fingerprint SHA-256 indipendente dal nome file | repository import | Implementato |
| Inserimento clienti, eventi e batch nella stessa transazione | `importPostgresCustomers` | Implementato |
| Rilevamento doppio batch e conflitti identificativo cliente | vincolo univoco tenant + lock transazionale | Implementato |
| Audit log dell'importazione | inserimento in `audit_logs` | Implementato |
| API protetta dal permesso data:import e limiti dimensione richiesta | `POST /api/import`, middleware HTTP | Implementata |
| Test integrazione import, deduplica, audit e isolamento tra organizzazioni | `postgres-import-repository.integration.test.ts` | Aggiunti; CI del commit finale da verificare |


## Gestione membri ed esportazione server-side — aggiornamento 2026-11-13

| Intervento | Evidenza | Stato |
|---|---|---|
| Elenco membri e aggiornamento ruolo/stato limitati all'organizzazione autenticata | `server/src/postgres-members-repository.ts`, route `GET/PATCH /api/members` | Codice presente; verifica CI del commit 610dd6f completata con successo |
| Protezioni contro auto-modifica e rimozione/sospensione dell'ultimo amministratore attivo | `updateOrganizationMember` e `server/test/postgres-members-repository.test.ts` | Test presenti; CI completata con successo sul commit 610dd6f |
| Schermata amministrativa dei membri visibile solo agli amministratori autenticati, non in demo | `client/src/components/AuthGate.tsx`, `client/src/App.tsx`, `client/src/components/MemberManagement.tsx` | Implementazione presente nel ramo; CI del commit successivo da completare |
| Esportazione CSV clienti dal server, filtrata per tenant e protetta da `data:export` | `server/src/postgres-export-repository.ts`, route `GET /api/export/customers.csv` | Implementazione presente nel ramo; limite massimo 100.000 righe per richiesta |
| Protezione CSV da formula injection e test intestazioni/tenant | `server/src/postgres-export-repository.ts`, `server/test/postgres-export-repository.test.ts` | Test aggiunti; CI del commit corrente da completare |
| Pulsante UI per esportare l'intero elenco clienti autorizzato dal server | `client/src/components/CustomerManagement.tsx` | Implementazione presente; test browser end-to-end ancora da eseguire |

La gestione membri non include ancora inviti o consegna email. Il CSV lato server riguarda i dati cliente e gli eventi; i report aggregati continuano a essere generati nel browser.


## Gestione membri PostgreSQL — aggiornamento

| Funzione | Evidenza | Stato |
|---|---|---|
| Elenco membri filtrato per organizzazione | `listOrganizationMembers` | Implementato |
| Modifica ruolo e stato membership con audit | `updateOrganizationMember` | Implementata |
| Blocco auto-modifica e tutela dell'ultimo amministratore attivo | lock transazionale e controlli repository | Implementati |
| Privilegio minimo SELECT/UPDATE sul ruolo HTTP | migrazione `007_membership_management.sql` | Implementato |
| Schermata web per gestione membri | `MemberManagement.tsx` | Implementata per ruolo admin |
| Verifica migrazione 007 su PostgreSQL temporaneo | `postgres-migrations.integration.test.ts` | Aggiunta |
| Inviti e accettazione collaboratori | API/UI non presenti | Da realizzare |
