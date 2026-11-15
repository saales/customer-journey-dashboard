# Registro delle evidenze tecniche

## Stato del ramo

- Ramo: `integration/staging-additions-hardening`
- Pull request: [#3](https://github.com/saales/customer-journey-dashboard/pull/3), aperta, draft e non unita
- Base: `recovery/checkpoint-12-postgres`
- Head verificato: `0c145413803dae9fd161cba742ac7a405c5237f8`
- Database applicativo: PostgreSQL
- Database remoto/Neon: non verificato in questa attività; nessuna migrazione, scrittura o modifica remota eseguita

## CI verificata

Run [43704074591](https://github.com/saales/customer-journey-dashboard/actions/runs/43704074591), sul commit head indicato, conclusa con successo su Node.js 20 e 22.

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

I run verdi precedenti (Node.js 20 e 22, browser E2E su Node.js 22) riguardano commit antecedenti all'ultimo recupero dei test dallo ZIP e non certificano il nuovo head. Il run 43705654748 sul commit b0370ff ha fallito in entrambi i job Node.js perché un nuovo test multi-tenant cercava externalId nella risposta HTTP, mentre la route restituisce gli ID numerici; 213 test server sono passati e 1 è fallito, mentre i 41 test client sono passati. Il test è stato corretto nel commit 10bd689, ma la CI per questo commit non risulta ancora disponibile. Non dichiarare verdi i test del nuovo head finché un run corrispondente non termina con successo.

La PR deve restare draft e non va unita né distribuita finché i gate in `docs/GATE_RILASCIO.md` non sono completati con evidenze verificabili.


## Recupero test dallo ZIP — 15 novembre 2026

Sono stati aggiunti al ramo due file di test d'integrazione con una prima selezione mirata di casi riscritti/adattati all'helper HTTP attuale (8 scenari multi-tenant e 11 casi export contando le quattro varianti di ruolo). Non è un porting integrale dei 34+17 casi originali nello ZIP:
- `server/test/multi-tenant-negative.integration.test.ts`: test HTTP cross-tenant su letture, update/delete, import con organizationId manipolato, RLS/ruolo runtime, viewer e identità con sessioni in due tenant.
- `server/test/export-json.integration.test.ts`: test HTTP su matrice ruoli, autenticazione, intestazioni e schema, contenuti secret-free e tenant-scoped, audit e ordinamento eventi.

Questi test sono stati ricostruiti prendendo come riferimento i casi nello ZIP, non copiati integralmente; restano da migrare gli altri casi limite delle suite originali. La loro esecuzione sulla CI del nuovo head è ancora da verificare; non conteggiarli come superati finché il relativo run GitHub Actions non è completato.


## Verifica CI successiva — 15 novembre 2026

- Run `43705654748`, commit `b0370ff6058f2113f0ed1d2d77f6ca2c03ddc0ea`: fallito su Node.js 20 e 22 per l'asserzione errata descritta sopra; non risultano errori nel test export JSON aggiunto.
- Correzione del test in `server/test/multi-tenant-negative.integration.test.ts`: usa gli ID dei fixture A/B che la route restituisce realmente, invece degli `externalId` che non sono esposti dalla risposta.
- Commit correttivo: `10bd6892e75ecede3bde897dea1a3c40e4608c1c`.
- Al momento dell'aggiornamento non è ancora visibile un run CI associato al commit correttivo. Il gate CI resta quindi aperto.
