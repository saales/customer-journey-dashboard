# Registro delle evidenze tecniche

## Stato del ramo

- Ramo: `integration/staging-additions-hardening`
- Pull request: [#3](https://github.com/saales/customer-journey-dashboard/pull/3), aperta, draft e non unita
- Base: `recovery/checkpoint-12-postgres`
- Database applicativo: PostgreSQL
- Database remoto/Neon: non verificato in questa attività; nessuna migrazione, scrittura o modifica remota eseguita
- Ultimo commit di codice verificato: `d2a7125be3805da833069d8e0df6c15a20d2d300`

## CI verificata

Run [43699864674](https://github.com/saales/customer-journey-dashboard/actions/runs/43699864674), commit `d2a7125be3805da833069d8e0df6c15a20d2d300`, conclusa con successo su Node.js 20 e 22.

| Controllo | Risultato |
|---|---:|
| Test server | 37 file, 171 test superati |
| Test client | 11 file, 41 test superati |
| Playwright/Chromium su Node.js 22 | 1 test E2E superato |
| npm audit | 0 vulnerabilità segnalate |
| Build client e server | Superata |
| Migrazioni PostgreSQL 001–013 | Superate su database temporaneo |
| Verifica storico/checksum migrazioni | Superata |
| Verifica policy RLS effettive | Superata |
| Avvio con ruolo runtime limitato | Superato |

La CI usa un PostgreSQL temporaneo e dati sintetici. Non verifica il database remoto e non costituisce prova di deploy o collaudo commerciale.

## Copertura di sicurezza e autorizzazioni

- Matrice HTTP sui ruoli admin, editor, analyst e viewer estesa alle principali route analytics, clienti, funnel, import/export, account, organizzazione, membri, inviti e audit.
- Test negativi cross-tenant su modifica e cancellazione clienti.
- Verifica che letture clienti, fasi funnel, membri e audit del tenant A non espongano dati del tenant B.
- Verifica export JSON isolato per organizzazione.
- Test di importazione con `organizationId` ostile nel payload: il server associa i record all'organizzazione della sessione, non a quella dichiarata dal client.
- Verifica RLS e policy tenant-scoped sulla base temporanea della CI.

La matrice copre le route elencate nei test, non ogni combinazione di input, stato e operazione di tutte le API. La copertura cross-tenant completa resta un gate aperto.

## Funzioni implementate e documentate

- Runtime PostgreSQL unico, migrazioni versionate 001–013 e runner con checksum.
- Ruolo runtime separato e limitato; verificatore read-only di database, TLS, schema, RLS, privilegi e migrazioni.
- Sessioni, login, logout, cambio password, recupero password e inviti con token monouso.
- Ruoli e permessi organizzativi, membership, audit e isolamento tenant.
- Import, CSV e export JSON tenant-scoped.
- Backup/restore staging con manifest SHA-256 e controlli di destinazione.
- Smoke test staging e controlli RLS.
- Controlli di validazione e regressione frontend/API.

## Elementi ancora aperti prima del rilascio

1. Eseguire il collaudo su uno staging reale, separato dalla produzione, con TLS, reverse proxy, cookie Secure e segreti configurati nel secret manager.
2. Eseguire e archiviare una prova di backup e restore su database isolato; definire RPO/RTO.
3. Verificare consegna reale di email invito e recupero password con dominio e provider configurati.
4. Completare la matrice di autorizzazioni e i test cross-tenant per tutte le API, incluse le azioni amministrative e i casi limite.
5. Eseguire test di carico, osservabilità, allarmi, rotazione log e verifica dei limiti di connessione PostgreSQL.
6. Documentare rollback applicativo e piano di ripristino compatibile con le migrazioni.
7. Completare revisione privacy/contrattuale e definire onboarding, supporto, prezzi, piani e fatturazione se il servizio viene venduto come SaaS.
8. Progettare ed eventualmente implementare una procedura sicura di cancellazione tenant. Nel ramo non è presente un comando dedicato con guardrail certificati: non effettuare cancellazioni manuali su ambienti reali.

## Decisione

Il codice e i test automatici del commit indicato sono verdi. Questo risultato non dimostra che il prodotto sia pronto al 100% per il mercato: staging reale, email, backup/restore, carico, monitoraggio, copertura completa delle API e aspetti commerciali/privacy non sono ancora certificati.

La PR deve restare draft e non va unita né distribuita finché i gate in `docs/GATE_RILASCIO.md` non sono completati con evidenze verificabili.
