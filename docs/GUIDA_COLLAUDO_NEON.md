# Guida operativa: primo collaudo su Neon (staging)

Da eseguire **tu**, in ordine, su un progetto Neon di **staging** (mai la produzione). Gli script sono già stati provati in locale;
questa è la prima esecuzione reale e va registrata. Dettagli e criteri nel documento `COLLAUDO_STAGING_BACKUP_RIPRISTINO.md`.
Le credenziali restano sul tuo computer: non incollarle in chat, nei ticket o nel repository.

## A. Cosa preparare (una volta)

1. **Progetto Neon di staging** e due ruoli:
   - proprietario (migrazioni, bootstrap, backup): usare l'endpoint **diretto**;
   - `percorso_app` (solo app): `LOGIN`, `NOINHERIT`, senza altri attributi; può usare l'endpoint pooler.
2. **File locale `.env.staging`** (non versionato: `.env.staging` è ora nel `.gitignore`) con le 3 connessioni, sempre con `?sslmode=verify-full`:
   ```
   OWNER_URL=postgresql://<proprietario>:...@<host-diretto>/<db>?sslmode=verify-full
   RUNTIME_URL=postgresql://percorso_app:...@<host>/<db>?sslmode=verify-full
   RESTORE_URL=postgresql://<proprietario>:...@<host-diretto>/<db-vuoto-per-ripristino>?sslmode=verify-full
   ```
   `<db-vuoto-per-ripristino>` è un database (o branch) **vuoto** nello stesso progetto di staging, dove esiste già il ruolo `percorso_app`.
3. **Variabili dell'app in staging** (dal tuo hosting): `DATABASE_URL`=`RUNTIME_URL`, `APP_ORIGIN`=URL https del frontend,
   `LOGIN_RATE_LIMIT_SECRET`=almeno 32 caratteri casuali, `PORT`, `TRUSTED_PROXY_IPS` se dietro proxy, e — per recupero password e inviti
   automatici — `RESEND_API_KEY` ed `EMAIL_FROM`.
4. Strumenti locali: Node, `pg_dump`/`pg_restore`/`psql` di versione **uguale o superiore** al server Neon.

## B. Sequenza (annota data, esito e file prodotti nel registro evidenze)

| # | Comando | Superato se |
|---|---|---|
| 1 | `export $(grep -v '^#' .env.staging \| xargs)` poi `DATABASE_URL=$OWNER_URL npm run db:migrate -- --check` | nessuna anomalia; elenca le migrazioni pendenti (database nuovo: tutte) |
| 2 | **Backup prima di toccare qualsiasi cosa**: `SOURCE_DATABASE_URL=$OWNER_URL CONFIRM_DATABASE=<db> scripts/staging/backup.sh` | file `.dump` + `.manifest.json` con SHA-256 |
| 3 | Applicare le migrazioni solo su staging, dopo averle riviste: `DATABASE_URL=$OWNER_URL npm run db:migrate` | "Applicate: 001…013" |
| 4 | Bootstrap: `BOOTSTRAP_DATABASE_URL=$OWNER_URL BOOTSTRAP_CONFIRM_DATABASE=<db> BOOTSTRAP_ORGANIZATION_NAME=… BOOTSTRAP_ORGANIZATION_SLUG=… BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME=… BOOTSTRAP_ADMIN_PASSWORD=… npm run db:bootstrap -- --confirm-empty-database` | organizzazione e 5 fasi create |
| 5 | Verifica read-only col ruolo app: `DATABASE_URL=$RUNTIME_URL npm run db:verify-readonly -- --expect-database <db>` | esito SUPERATO, **TLS attivo**, nessun avviso sul ruolo |
| 6 | Creare gli altri 3 utenti (editor, analyst, viewer) tramite inviti dall'app e un **secondo tenant** con il suo admin; compilare `credentials.json` (schema in `scripts/staging/smoke.mjs`) | 4 ruoli + tenant B pronti |
| 7 | Smoke test con dati sintetici: `STAGING_URL=https://<staging> node scripts/staging/smoke.mjs --credentials ./credentials.json --seed --evidence-dir ./evidence` | tutti i controlli superati; file di evidenza prodotto |
| 8 | Backup post-collaudo: ripetere il punto 2 | nuovo `.dump` verificato |
| 9 | **Prova di ripristino**: `BACKUP_FILE=<dump del punto 8> TARGET_DATABASE_URL=$RESTORE_URL CONFIRM_DATABASE=<db-vuoto> SOURCE_DATABASE_URL=$OWNER_URL scripts/staging/restore-verify.sh` | conteggi identici all'origine |
| 10 | Sul ripristinato: `DATABASE_URL=<runtime sul db di ripristino> npm run db:verify-readonly -- --expect-database <db-vuoto>` e `… npm run db:migrate -- --check` | entrambi superati |
| 11 | Avviare l'app sul database ripristinato e rieseguire lo smoke **senza** `--seed` | tutti superati |
| 12 | Prova dell'instant restore di Neon: annotare l'ora, fare una modifica di prova su staging, ripristinare il branch a un istante precedente (Console Neon → Restore), verificare che la modifica sia sparita | recupero confermato entro la history window |
| 13 | Prova di cancellazione tenant: `TENANT_ADMIN_DATABASE_URL=$OWNER_URL npm run db:delete-tenant -- --slug <tenant-B> --confirm-database <db>` (anteprima), poi con `--execute --confirm-slug` | ricevuta JSON; tenant A intatto |

## C. Controlli manuali da interfaccia (registrare con screenshot)
Accesso da browser reale su HTTPS; invito → accettazione; importazione di un CSV sintetico; esportazione CSV/JSON; sospensione di un membro con sessione già aperta; "Hai dimenticato la password?" con email reale (verifica `RESEND_API_KEY`); tema scuro e mobile.

## D. Se un punto fallisce
Si ferma il collaudo: **NO-GO**. Non proseguire ai punti successivi. Salvare l'output (senza credenziali), correggere la causa, ripartire dal punto 1.
Ripristino rapido dello staging: punto 12 (instant restore) oppure ripristino del dump del punto 2.

## E. Cosa serve oltre al collaudo tecnico per poter "vendere"
Il collaudo dimostra che il software è corretto e recuperabile; **non** rende da solo il prodotto commerciabile. Prima di proporlo a un'azienda servono, da definire con le persone competenti:
- **Privacy e contratti**: informativa privacy, accordo di trattamento dati (DPA) come responsabile del trattamento, termini di servizio, indicazione dei sub-responsabili (hosting, Neon, servizio email).
- **Operatività**: monitoraggio e allarmi (errori 5xx, database), piano di assistenza, politica di backup/retention concordata col cliente, procedura di incidente.
- **Sicurezza di terze parti** se richiesta dal cliente: test di penetrazione indipendente.
- **Pubblicazione in produzione** con la procedura di `DISTRIBUZIONE_PRODUZIONE.md` (reverse proxy, HTTPS, rollback).
Presentandolo come lavoro tuo in Deloitte, verifica prima con l'azienda le regole su proprietà intellettuale e attività esterne del tuo contratto.
