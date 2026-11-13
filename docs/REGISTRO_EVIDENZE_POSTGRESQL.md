# Registro delle evidenze PostgreSQL

**Aggiornato:** 2026-11-13  
**Branch:** `recovery/checkpoint-12-postgres`  
**Commit codice verificato:** `d35d395d5e63bdab8c7a2fcf361cae0d806c67ad` (CI Node 20/22, run [43432840146](https://github.com/saales/customer-journey-dashboard/actions/runs/43432840146)).  
**Branch HEAD al checkpoint documentale:** `669fe89d82fdbf9d172a76e9c57fbbe36b53e6f3` (include aggiornamenti documentali successivi al checkpoint codice `d35d395`).  
**PR:** [#1](https://github.com/saales/customer-journey-dashboard/pull/1), aperta in bozza, non merged.

Questo registro distingue il codice effettivamente presente nel branch, gli artefatti recuperati dallo ZIP checkpoint 12 e lo stato remoto non verificato. Non certifica lo stato del database Neon.

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

1. La migrazione 001 non abilita RLS: la sicurezza tenant dipende quindi dalle query applicative esplicitamente filtrate, finché non verranno progettate e testate policy RLS.
2. La migrazione 001 non persiste `external_id`, mentre l'import del checkpoint ZIP lo usa per raggruppare le righe; serve una decisione sulla deduplicazione e sull'identità esterna per organizzazione.
3. La migrazione 002 lascia nullable `sessions.organization_id`: le sessioni legacy senza organizzazione non potranno autenticarsi tramite il join applicativo descritto nello ZIP.
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
- CI PostgreSQL 16 verde su Node 20 e 22, run [43432840146](https://github.com/saales/customer-journey-dashboard/actions/runs/43432840146): `npm ci`, `npm test`, `npm run build) riusciti su entrambi.
- Il repository non è collegato all'API perché manca ancora un contesto utente/membership autenticato. Le route continuano a usare SQLite.
- Neon non è stato ispezionato né modificato; nessun DDL remoto eseguito.
