# Registro delle evidenze tecniche

## Stato del ramo

- Ramo: `integration/staging-additions-hardening`
- Pull request: [#3](https://github.com/saales/customer-journey-dashboard/pull/3), aperta, draft e non unita
- Base: `recovery/checkpoint-12-postgres`
- Head verificato: `0c145413803dae9fd161cba742ac7a405c5237f8`
- Database applicativo: PostgreSQL
- Database remoto/Neon: non verificato in questa attività; nessuna migrazione, scrittura o modifica remota eseguita

## CI verificata

Run [43704074591](https://github.com/saales/customer-journey-dashboard/actions/runs/43704074591), sul commit head indicato, conclusa con successo su Node.js 22, 24 e 26.

| Controllo | Node.js 20 | Node.js 22 |
|---|---:|---:|
| Test server | 41 file, 195 test superati | 41 file, 195 test superati |
| Test client | 11 file, 41 test superati | 11 file, 41 test superati |
| Playwright/Chromium | Saltato per configurazione CI | 1 test E2E superato |
| npm audit | 0 vulnerabilità | 0 vulnerabilità |
| Build client e server | Superata | Superata |
| Migrazioni PostgreSQL 001–013 | Superate su database temporaneo | Superate su database temporaneo |
| Verifica storico/checksum migrazioni | Superata | Superata |
| Verifica policy RLS effettive | Superata | Superata |
| Avvio con ruolo runtime limitato | Superato | Superato |

La CI usa PostgreSQL temporaneo e dati sintetici. Non verifica il database remoto e non costituisce prova di deploy o collaudo commerciale. Il test E2E browser viene eseguito soltanto sul job Node.js 22.

## Confronto con lo ZIP consegnato

Lo ZIP più recente contiene 192 file; il tree del ramo GitHub head ne contiene 178. Le differenze non sono tutte regressioni: il ramo ha aggiunto guide e strumenti di staging e ha consolidato documenti duplicati. Tuttavia, nello ZIP sono presenti due suite d'integrazione che non risultano nel ramo:

- `server/test/multi-tenant-negative.integration.test.ts`: 34 casi, inclusi test di isolamento su eventi/clienti, KPI e segmenti, externalId, importazioni, membri, inviti, RLS, vincoli FK, audit e ruolo runtime.
- `server/test/export-json.integration.test.ts`: 17 casi, inclusi permessi, intestazioni, audit, contenuto privo di segreti, schema/ordinamento, limiti di 100.000 righe e snapshot coerente con scritture concorrenti.

Nel ramo sono presenti `authorization-matrix.integration.test.ts` e `postgres-export-repository.test.ts`, che coprono una parte di questi aspetti, ma non costituiscono una sostituzione dimostrata dell'intera copertura delle due suite. Il ripristino o la migrazione selettiva di questi test è un'attività aperta prima di considerare completa la copertura cross-tenant/export.

## Copertura di sicurezza e autorizzazioni

- Matrice HTTP sui ruoli admin, editor, analyst e viewer per le principali route analytics, clienti, funnel, import/export, account, organizzazione, membri, inviti e audit.
- Test negativi cross-tenant su modifica e cancellazione clienti.
- Verifica che letture clienti, fasi funnel, membri e audit del tenant A non espongano dati del tenant B.
- Verifica export JSON isolato per organizzazione.
- Test di importazione con `organizationId` ostile nel payload: il server associa i record all'organizzazione della sessione, non a quella dichiarata dal client.
- Verifica RLS e policy tenant-scoped sulla base temporanea della CI.
- Test della cancellazione tenant: anteprima read-only, cancellazione transazionale, isolamento degli altri tenant, utente condiviso, attesa di scritture concorrenti, rifiuto del ruolo runtime e rollback in caso di errore.

La matrice copre le route elencate nei test, non ogni combinazione di input, stato e operazione di tutte le API. La copertura cross-tenant completa resta un gate aperto.

## Funzioni implementate e documentate

- Runtime PostgreSQL unico, migrazioni versionate 001–013 e runner con checksum.
- Ruolo runtime separato e limitato; verificatore read-only di database, TLS, schema, RLS, privilegi e migrazioni.
- Sessioni, login, logout, cambio password, recupero password e inviti con token monouso.
- Ruoli e permessi organizzativi, membership, audit e isolamento tenant.
- Import, CSV e export JSON tenant-scoped.
- Backup/restore staging con manifest SHA-256 e controlli di destinazione.
- CLI amministrativa per anteprima/cancellazione tenant con conferme esplicite; `--confirm-backup` è una dichiarazione dell'operatore e non una verifica automatica del backup.
- Test d'integrazione del ciclo di vita HTTP delle sessioni e del rate limit API configurabile.
- Smoke test staging e controlli RLS.
- Controlli di validazione e regressione frontend/API.

## Elementi ancora aperti prima del rilascio

1. Eseguire il collaudo su uno staging reale, separato dalla produzione, con TLS, reverse proxy, cookie Secure e segreti configurati nel secret manager.
2. Eseguire e archiviare una prova di backup e restore su database isolato; definire RPO/RTO.
3. Verificare consegna reale di email invito e recupero password con dominio e provider configurati.
4. Ripristinare o migrare selettivamente le due suite presenti nello ZIP e completare la matrice di autorizzazioni/casi limite per tutte le API.
5. Eseguire test di carico, osservabilità, allarmi, rotazione log e verifica dei limiti di connessione PostgreSQL.
6. Documentare rollback applicativo e piano di ripristino compatibile con le migrazioni.
7. Completare revisione privacy/contrattuale e definire onboarding, supporto, prezzi, piani e fatturazione se il servizio viene venduto come SaaS.
8. Revisionare i casi limite della cancellazione tenant e provarla esclusivamente su database usa-e-getta prima di considerarla operativa. Non eseguire cancellazioni su ambienti reali.

## Decisione

La run CI `43706482217` sul commit `3bab4d201f89c9d04a10729ecb0c1c5e6771a0ae` è completata con entrambi i job verdi: Node.js 22, 24 e 26 hanno superato test, build, audit dipendenze, migrazioni PostgreSQL, checksum e verifiche RLS; sul job Node.js 22 è passato anche il test browser Playwright. Il precedente run `43705654748` sul commit `b0370ff` era fallito per l'asserzione errata su externalId, corretta successivamente. Questa run verde include i due test di snapshot concorrente e rollback export introdotti nel commit `93e189d`, ma NON include i test multi-tenant aggiunti dopo sul commit `6fe2c8c` e la correzione regex del commit `483184c`. Per questi ultimi il gate CI resta da ripetere.

La run CI usa database PostgreSQL temporanei e dati sintetici: non è un collaudo su Neon/staging remoto e non prova backup/restore, consegna email o comportamento in produzione.

La PR deve restare draft e non va unita né distribuita finché i gate in `docs/GATE_RILASCIO.md` non sono completati con evidenze verificabili.


## Recupero test dallo ZIP — 15 novembre 2026

Sono stati aggiunti al ramo due file di test d'integrazione con una prima selezione mirata di casi riscritti/adattati all'helper HTTP attuale (8 scenari multi-tenant e 11 casi export contando le quattro varianti di ruolo). Non è un porting integrale dei 34+17 casi originali nello ZIP:
- `server/test/multi-tenant-negative.integration.test.ts`: test HTTP cross-tenant su letture, update/delete, import con organizationId manipolato, RLS/ruolo runtime, viewer e identità con sessioni in due tenant.
- `server/test/export-json.integration.test.ts`: test HTTP su matrice ruoli, autenticazione, intestazioni e schema, contenuti secret-free e tenant-scoped, audit e ordinamento eventi.

Questi test sono stati ricostruiti prendendo come riferimento i casi nello ZIP, non copiati integralmente; restano da migrare gli altri casi limite delle suite originali. La loro esecuzione sulla CI del nuovo head è ancora da verificare; non conteggiarli come superati finché il relativo run GitHub Actions non è completato.


## Verifica CI successiva — 15 novembre 2026

- Run `43705654748`, commit `b0370ff6058f2113f0ed1d2d77f6ca2c03ddc0ea`: fallito su Node.js 22, 24 e 26 per l'asserzione errata descritta sopra; non risultano errori nel test export JSON aggiunto.
- Correzione del test in `server/test/multi-tenant-negative.integration.test.ts`: usa gli ID dei fixture A/B che la route restituisce realmente, invece degli `externalId` che non sono esposti dalla risposta.
- Commit correttivo: `10bd6892e75ecede3bde897dea1a3c40e4608c1c`.
- Al momento dell'aggiornamento non è ancora visibile un run CI associato al commit correttivo. Il gate CI resta quindi aperto.


## Ulteriore recupero test export — 15 novembre 2026

Nel commit `93e189dd896e7dda9abc6d482bbd0117c2db57f2` è stata ampliata la suite `server/test/export-json.integration.test.ts` con due test di integrazione del repository:
- snapshot `REPEATABLE READ`: scritture committate da un'altra connessione durante l'export non devono comparire nello snapshot corrente, mentre devono essere visibili in un export successivo;
- rollback su limite superato: nessun audit di export deve essere scritto e nessuna connessione deve restare in stato `idle in transaction`.

I test usano il database temporaneo e i fixture creati appositamente; non sono ancora verificati da una run CI sul commit. Le prove con volumi di 100.000 righe e gli altri casi limite originali non sono ancora stati migrati integralmente.


## Estensione test multi-tenant — 15 novembre 2026

Nel commit `6fe2c8c406c9766bc4862d3caa70998cd35c2559` sono stati aggiunti alla suite HTTP test per: elenco membri limitato al tenant A; PATCH verso membership/userId del tenant B con controllo di integrità; divieto di auto-demozione dell'amministratore; attributi del ruolo runtime non privilegiato; RLS senza contesto tenant su sei tabelle. La regex di controllo email è stata corretta nel commit `483184c2e244bdcc9699ebceac1fef9905ffec8c`. Questi nuovi test non sono ancora coperti dalla run verde 43706482217 e richiedono una nuova CI sul head aggiornato.


## CI per i test multi-tenant aggiunti — 15 novembre 2026

È stata avviata la run `43706996610` (run number 507) sul commit `a2b0e46fb37a09f12b9a495b76663f2b1546d920`, che contiene il nuovo head con i test multi-tenant. Entrambi i job Node.js 22, 24 e 26 risultano avviati; al momento della registrazione stanno inizializzando i container e non hanno ancora eseguito i test. Esito da verificare: [GitHub Actions 43706996610](https://github.com/saales/customer-journey-dashboard/actions/runs/43706996610).


## Test aggiuntivi import e inviti — 15 novembre 2026

Nel commit `53adce916be03f0cd60ded6edaf847d859c130e1` sono stati aggiunti test HTTP per: fingerprint anti-duplicato tenant-scoped e riuso dello stesso externalId tra tenant; rifiuto di una fase funnel disponibile solo nell'altro tenant senza scritture; rollback atomico su collisione cliente a metà import; limite di 10.000 righe. Nel commit `22afb0a6f61fade5e525a9943b093a31497ef201` sono stati aggiunti test per isolamento dell'elenco inviti, impossibilità di revocare inviti cross-tenant e rifiuto di inviti scaduti/revocati senza creazione di utenti o membership. Questi test sono aggiunte successive alla run verde 43707129653: devono ancora essere eseguiti da CI sul nuovo head.


## Correzione test import — CI 43707939611

La run `43707939611` ha rilevato un errore nell'asserzione del nuovo test: il fixture tenant B contiene già `only-b-2`, quindi il tentativo di reimportare lo stesso externalId nello stesso tenant deve essere rifiutato (409), non accettato. Il test è stato corretto separando due proprietà: riuso dello stesso externalId tra tenant (ammesso) e fingerprint identico tra tenant (ammesso una volta per ciascun tenant, poi 409 nel tenant che lo ha già importato). Il job Node.js 20 ha riportato 232 test passati e 1 fallito; il job Node.js 22 era ancora in corso al momento dell'aggiornamento ed è stato interrotto dall'aggiornamento del branch. Nuova CI necessaria sul nuovo head.


## CI verde — import, inviti e RLS approfondito — 15 novembre 2026

La run `43708284398` sul commit `ccab40f37b20efb58bec3b280d0b52a2f6f19214` è completata con successo. Node.js 20 e Node.js 22: 43 file server / 233 test passati e 11 file client / 41 test passati per ciascuna versione; audit npm con 0 vulnerabilità; build superata; migrazioni PostgreSQL, checksum, ruolo runtime ristretto e verifiche RLS superati. Node.js 22 ha inoltre completato con successo il test browser Playwright (1 test). La run comprende i test HTTP import e inviti e i nuovi controlli RLS per contesto A, policy WITH CHECK e FK composita. [Run CI 43708284398](https://github.com/saales/customer-journey-dashboard/actions/runs/43708284398).

Questa evidenza è CI su database temporaneo e fixture sintetici; non sostituisce il collaudo remoto staging, il backup/restore reale, i test di consegna email o le verifiche operative prima del rilascio.


## Verifica CI del nuovo head — 15 novembre 2026

La PR #3 punta al commit `b3db3943d3df97e58e0df84afdc9c1019be5aa6f`. La run [43744176994](https://github.com/saales/customer-journey-dashboard/actions/runs/43744176994) è completata con successo su entrambi i job:

- Node.js 20: 43 file server / 240 test passati; 11 file client / 41 test passati; build superata; `npm audit` con 0 vulnerabilità.
- Node.js 22: gli stessi 43 file server / 240 test e 11 file client / 41 test passati; build superata; `npm audit` con 0 vulnerabilità; Playwright/Chromium: 1 test browser superato.
- Entrambi i job hanno completato la creazione del ruolo runtime limitato, applicazione delle migrazioni PostgreSQL, verifica storico/checksum e controlli effettivi delle policy RLS.
- I test aggiunti e inclusi in questa run coprono accettazione dell'invito B con organizzazione/ruolo determinati dal token, invito a un indirizzo già membro di un altro tenant senza disclosure, isolamento analytics/segmenti/audit, export JSON con snapshot coerente durante scritture concorrenti, confine di 100.000 record esportabili per risorsa e rollback/rilascio connessioni quando il limite viene superato.

Conteggio attuale delle dichiarazioni `it(...)` nelle due suite sul branch: 25 in `multi-tenant-negative.integration.test.ts` e 10 in `export-json.integration.test.ts`. Questi numeri descrivono le dichiarazioni presenti nel branch, non il numero totale dei test dell'intero progetto. Rispetto alle suite originali nello ZIP (34 e 17 dichiarazioni rispettivamente), il recupero è ancora selettivo: la CI verde non dimostra equivalenza di copertura con lo ZIP.

La CI utilizza PostgreSQL temporaneo e fixture sintetici. Non dimostra il comportamento su Neon o su staging reale, né backup/restore effettivi, consegna email, carico, monitoraggio, rollback operativo o conformità privacy/contrattuale. La PR resta draft e non merged; nessun deploy o intervento sul database remoto è stato eseguito.


## Hardening autenticazione e preflight TLS — CI 43746466226

La run [43746466226](https://github.com/saales/customer-journey-dashboard/actions/runs/43746466226) sul commit `136261251cef94a931f615146635ce741608ebf2` è completata con successo su Node.js 22, 24 e 26. Per ciascuna versione: 43 file server / 244 test server passati, 11 file client / 41 test client passati, build superata, `npm audit` con 0 vulnerabilità note, migrazioni/checksum/RLS e avvio del runtime con ruolo limitato superati; Playwright su Node 22: 1 test browser superato.

Modifiche incluse: limite login anche per account indipendentemente dall'IP; limite recupero password per email; token monouso di invito/reset trasferiti nei frammenti URL e rimossi dalla barra indirizzi, mantenendo compatibilità con i link query legacy; controllo TLS all'avvio in produzione; verifica scrypt fittizia per ridurre enumerazione account tramite timing.

## Ispezione PostgreSQL sequenziale — CI 43746713179

La run [43746713179](https://github.com/saales/customer-journey-dashboard/actions/runs/43746713179) sul commit `ab7fb7a78bd593f9f69ef070925c7c5146fdce46` è completata con successo su Node.js 22, 24 e 26. Per ciascuna versione: 43 file server / 245 test server passati, 11 file client / 41 test client passati, build superata, `npm audit` con 0 vulnerabilità note, migrazioni/checksum/RLS e runtime ristretto superati; Playwright su Node 22: 1 test browser superato.

È stata resa sequenziale l'ispezione dei cataloghi PostgreSQL, che in precedenza accodava query concorrenti sullo stesso `PoolClient` e generava un avviso di deprecazione del driver. Il nuovo test verifica che non vi siano query sovrapposte. Restano avvisi di deprecazione `punycode` e `url.parse()` provenienti da dipendenze; non risultano vulnerabilità note nell'audit npm.

Queste verifiche sono eseguite in CI su PostgreSQL temporaneo e fixture sintetici. Non attestano staging remoto, backup/restore reale, test indipendente di penetrazione, configurazione operativa o sicurezza assoluta. La PR resta draft/non merged e non è stato eseguito alcun deploy.


## Hardening credenziali e sessioni — CI 43747401019

La run [43747401019](https://github.com/saales/customer-journey-dashboard/actions/runs/43747401019) sul commit `07b7a511c8446664a4098013eeec6b6d27f6ef30` è completata con successo su Node.js 22, 24 e 26.

Per ciascuna versione: 43 file server / 246 test passati; 11 file client / 41 test passati; build superata; `npm audit` con 0 vulnerabilità note; migrazioni/checksum PostgreSQL, policy RLS effettive e avvio del runtime con ruolo limitato superati. Node.js 22 ha superato anche Playwright/Chromium (1 test browser).

Modifiche incluse:
- scrypt per nuove password con `N=32768, r=8, p=3`; verifica compatibile con hash legacy `p=1` e aggiornamento automatico al login riuscito o accettazione invito;
- verifica scrypt fittizia per account inesistenti;
- session issuance con lock e controllo dell'hash esatto verificato, con aggiornamento hash e inserimento sessione nella stessa transazione;
- verifica TLS sulla connessione PostgreSQL effettiva all'avvio in produzione;
- limiti di tentativi per account/email oltre che per IP;
- token monouso nei frammenti URL, pulizia della barra indirizzi e compatibilità legacy;
- ispezione schema PostgreSQL sequenziale sullo stesso client.

Il log CI non mostra più l'avviso relativo a query concorrenti sullo stesso `PoolClient`. Restano warning di deprecazione `punycode` e `url.parse()` provenienti da dipendenze, senza vulnerabilità note segnalate da `npm audit`.

La verifica resta limitata a CI, PostgreSQL temporaneo e fixture sintetici. Non attesta staging remoto, backup/restore reale, email, test di carico, monitoraggio, rollback operativo o penetration test indipendente. MFA/SSO per gli account privilegiati resta un gate prima del pilot.
