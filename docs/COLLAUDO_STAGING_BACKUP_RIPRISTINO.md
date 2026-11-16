# Procedura di collaudo, backup e ripristino (staging)

Questa procedura prepara il collaudo su un ambiente di staging PostgreSQL/Neon **separato dalla produzione**.
Non applica migrazioni da sola e non tocca la produzione. Ogni passo ha un criterio di superamento e produce
un'evidenza da archiviare.

> Stato: gli script sono stati provati **in locale** (PostgreSQL 16, ruolo runtime non privilegiato, server reale).
> Non sono ancora stati eseguiti su Neon: la prima esecuzione su Neon va registrata nel registro evidenze.

## 0. Principi

1. Staging ≠ produzione: progetto Neon (o almeno branch) e credenziali distinti. Mai dati reali di clienti: solo dati sintetici.
2. Due ruoli database: **proprietario** (solo migrazioni/bootstrap/backup) e **`percorso_app`** (solo runtime HTTP, non privilegiato).
3. Ogni strumento chiede la conferma esplicita del nome del database e si ferma se non coincide.
4. Endpoint **diretto** (senza `-pooler`) per migrazioni e `pg_dump`; il pooler va bene per l'app e per la verifica read-only.
5. I file di backup contengono dati: permessi 600, cifratura a riposo, mai nel repository.

## 1. Preparazione dell'ambiente

| Passo | Azione | Superato se |
|---|---|---|
| 1.1 | Creare progetto/branch Neon di staging e il ruolo `percorso_app` (`LOGIN`, `NOINHERIT`, nessun attributo elevato) | il ruolo esiste |
| 1.2 | Impostare la finestra di storico per l'instant restore (Console → Settings → Instant restore) in base al piano scelto | finestra ≥ 24 h annotata nel registro |
| 1.3 | Preflight migrazioni (sola lettura): `npm run db:migrate -- --check` con il ruolo proprietario | nessuna anomalia; pendenti elencate |
| 1.4 | Applicare le migrazioni **solo dopo approvazione** e solo su staging: `npm run db:migrate` | `Applicate: 001…013` |
| 1.5 | Bootstrap tenant e amministratore di staging (`npm run db:bootstrap`, con `BOOTSTRAP_CONFIRM_DATABASE`) | organizzazione + 5 fasi create |
| 1.6 | Creare, tramite l'app (inviti) o SQL controllato, un utente per ciascun ruolo e un **secondo tenant** con il suo admin | 4 ruoli + tenant B |

## 2. Verifica read-only del database (prima di ogni collaudo)

```bash
# DATABASE_URL = connessione del ruolo percorso_app (sslmode=require)
npm run db:verify-readonly -- --expect-database <nome-database-staging> [--estimates] [--json]
```

Controlla in `BEGIN READ ONLY` (solo SELECT/SHOW, nessuna riga applicativa letta, nessuna migrazione):
database corretto, TLS, 14 tabelle attese, RLS e policy sulle 6 tabelle tenant, ruolo non privilegiato e non proprietario,
privilegi minimi presenti, **nessun privilegio distruttivo** (audit/sessioni/utenti/storico migrazioni), storico migrazioni con checksum, migrazioni pendenti.

Codici di uscita: `0` superato · `2` almeno un controllo fallito · `1` errore di esecuzione.
Con un database vuoto o non migrato il risultato è `2` con "migrazioni pendenti", non un crash.
Usare `--role any` solo per ispezionare con un ruolo diverso da quello runtime (l'esito resta un report).

## 3. Collaudo funzionale

### 3.1 Suite automatica locale (prima di ogni rilascio)
`npm test -w server` con `DATABASE_URL` locale. Le suite di integrazione creano un database temporaneo e un ruolo con nome univoco,
applicano le migrazioni reali e li eliminano a fine test. **Non partono** se `DATABASE_URL` non è locale (mai su Neon).

| Suite | Cosa dimostra |
|---|---|
| `authorization-matrix` | 4 ruoli × ogni endpoint `/api` + test di completezza che confronta le route registrate |
| `multi-tenant-negative` | eventi, importazioni, membri, inviti, RLS del database con ruolo runtime |
| `session-lifecycle` | scadenza assoluta 12 h, inattività 30 min, revoca, cambio/recupero password, sospensioni, rate limit login |
| `export-json` | limite 100.000 righe (confine esatto), snapshot coerente con scritture concorrenti, isolamento tenant |
| `postgres-readonly-verification` | il verificatore read-only non scrive e segnala drift, RLS mancante, privilegi in eccesso |

### 3.2 Smoke test sull'istanza di staging in esecuzione
```bash
STAGING_URL=https://<staging> node scripts/staging/smoke.mjs --credentials ./credentials.json --seed --evidence-dir ./evidence
```
`credentials.json` è un file locale non versionato (schema nell'intestazione dello script). `--seed` importa 300 clienti **sintetici**
deterministici tramite la vera API di importazione. Il test verifica: salute e intestazioni di sicurezza (HSTS su HTTPS), login dei 4 ruoli e
attributi del cookie (`__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`), matrice di permessi sugli endpoint chiave, CSRF su `Origin`,
export JSON coerente con l'elenco clienti, isolamento tra due tenant, revoca delle sessioni al logout. Esito `0` = tutti superati; `2` = fallimenti.
Il file JSON di evidenza non contiene token né password.

### 3.3 Controlli manuali da registrare
- Invito → accettazione → primo accesso con il ruolo corretto.
- Importazione CSV reale da interfaccia (file sintetico) e visualizzazione del funnel.
- Export CSV e JSON da interfaccia e voce corrispondente nel registro attività.
- Sospensione di un membro e accesso negato alla sessione già aperta.

## 4. Backup

| Livello | Strumento | Uso |
|---|---|---|
| A. Recupero rapido | Neon **instant restore** (history window per piano: 6 h Free, fino a 7 giorni Launch, fino a 30 giorni Scale — verificare sul proprio piano) | errori recenti, restore del branch root a un istante |
| B. Backup logico | `scripts/staging/backup.sh` (`pg_dump` formato custom) | copia portabile, indipendente dal fornitore, prima di ogni rilascio |

```bash
SOURCE_DATABASE_URL='postgresql://…@<host-diretto>/<db>?sslmode=require' \
CONFIRM_DATABASE=<db> BACKUP_DIR=./backups scripts/staging/backup.sh
```
Lo script: rifiuta endpoint pooler e `pg_dump` più vecchio del server; produce `<db>_<UTC>.dump` (permessi 600), verifica che
`pg_restore --list` lo legga e scrive `<file>.manifest.json` con SHA-256, versione server, dimensione, numero migrazioni.
È di sola lettura sul database di origine.

**Frequenza minima**: backup logico prima di ogni migrazione e prima di ogni rilascio; instant restore sempre attivo.
**Retention**: almeno gli ultimi 7 backup giornalieri e 4 settimanali, conservati fuori dal repository e cifrati.

## 5. Ripristino e prova di ripristino

Un backup non provato non è un backup. La prova va fatta **prima** del go-live e dopo ogni cambio di procedura.

```bash
BACKUP_FILE=./backups/<file>.dump \
TARGET_DATABASE_URL='postgresql://…@<host-diretto>/<db-vuoto>?sslmode=require' \
CONFIRM_DATABASE=<db-vuoto> SOURCE_DATABASE_URL=<origine, opzionale> \
scripts/staging/restore-verify.sh
```
Lo script rifiuta di scrivere se: il checksum non corrisponde al manifest, la destinazione coincide con l'origine, contiene già tabelle,
oppure il ruolo `percorso_app` non esiste nella destinazione. Poi ripristina (`--exit-on-error`), verifica migrazioni/RLS/policy e, se indicata
l'origine, confronta i conteggi per tabella (solo conteggi aggregati: usare solo su staging con dati sintetici).

Dopo il ripristino, con il ruolo runtime sulla destinazione:
1. `npm run db:verify-readonly -- --expect-database <db-vuoto>` → superato.
2. `npm run db:migrate -- --check` → nessuna anomalia, nessuna pendente.
3. Avviare un'istanza dell'app sulla destinazione e rieseguire `smoke.mjs` (senza `--seed`).

**Ripristino in caso di incidente (staging o produzione)**
1. Fermare le scritture (modalità manutenzione o spegnimento dell'app) e annotare l'ora dell'incidente.
2. Recupero rapido: instant restore del branch a un istante precedente all'incidente (crea un backup dello stato pre-restore se richiesto dallo strumento); oppure ripristino del dump in un branch/database nuovo e commutazione di `DATABASE_URL`.
3. Eseguire i passi 1–3 sopra prima di riaprire il traffico.
4. Revocare tutte le sessioni se la credenziale è sospetta compromessa (`DELETE FROM sessions` come proprietario) e far reimpostare le password interessate.
5. Registrare causa, tempi (RPO = dati persi, RTO = tempo di ripristino) e azioni correttive.

## 6. Criteri di uscita (GO / NO-GO)

**GO** solo se tutti veri:
- suite server completa verde in CI e in locale;
- `db:verify-readonly` esito `0` su staging, con TLS attivo;
- `smoke.mjs` senza fallimenti su staging;
- prova di ripristino completata, conteggi identici, verifica read-only e smoke verdi sul database ripristinato;
- backup logico e instant restore attivi, con history window dichiarata;
- difetti aperti (sezione 7) corretti o accettati per iscritto.

**NO-GO** se: un solo controllo fallisce, la prova di ripristino non è stata fatta, o un test cross-tenant fallisce.

## 7. Difetti rilevati dai test

| # | Gravità | Descrizione | Stato |
|---|---|---|---|
| 1 | Alta (funzionale) | `PATCH /api/members/:id` (cambio ruolo/sospensione) rispondeva sempre 500: la query di audit usava `jsonb_build_object` con parametri senza cast. | **Corretto** (`postgres-members-repository.ts`); test di regressione con audit ed effetto immediato sulla sessione |
| 2 | Media | Errori di input del client (ID non numerico, fase sconosciuta, parametri mancanti sui segmenti, nome fase troppo lungo, riordino con ID ignoto, nome fase duplicato) rispondevano 500. | **Corretto**: `PostgresValidationError` → 400/409 con messaggio; gli errori interni restano 500 senza dettagli; 11 casi di regressione |
| 3 | Media | `events → funnel_stages` è `ON DELETE RESTRICT`: eliminare un'organizzazione con eventi falliva. | **Corretto** con la procedura `npm run db:delete-tenant` (sezione 9): anteprima di default, doppia conferma, una sola transazione, 6 test di integrazione |
| 4 | Bassa | Il test `postgres-session-resolver.integration` non aveva `skipIf` e falliva senza `DATABASE_URL`. | **Corretto** |
| 5 | **Alta (frontend)** | Aprendo "Confronti" l'intera applicazione andava in pagina bianca: un `useMemo` dopo i `return` anticipati violava le regole degli Hook di React. Trovato con un controllo dell'interfaccia in un browser reale. | **Corretto**; test di regressione che fallisce sul codice originale (2/2) e passa su quello corretto |
| 6 | Bassa (frontend) | Il campo «Codice organizzazione» aveva un attributo `pattern` non valido per i browser (modalità `v`): la validazione veniva ignorata e la console segnalava un errore. | **Corretto** (`ORGANIZATION_SLUG_PATTERN`) con test di regressione |

## 8. Modello di registro evidenze (una riga per esecuzione)

| Data (UTC) | Ambiente | Passo | Comando / script | Esito | File evidenza | Operatore |
|---|---|---|---|---|---|---|
| | | | | | | |

## 9. Cancellazione definitiva di un tenant

Da eseguire solo con il ruolo **proprietario** (il ruolo HTTP non ha `DELETE` su `organizations`), dopo backup e prova di ripristino.

```bash
# 1) Anteprima (nessuna scrittura): conteggi per tabella e utenti candidati alla rimozione
TENANT_ADMIN_DATABASE_URL=<ruolo proprietario, endpoint diretto> \
npm run db:delete-tenant -- --slug <slug> --confirm-database <nome-db>

# 2) Cancellazione reale (irreversibile): doppia conferma
TENANT_ADMIN_DATABASE_URL=... npm run db:delete-tenant -- --slug <slug> --confirm-database <nome-db> --execute --confirm-slug <slug>
```
In una sola transazione: elimina gli eventi, l'organizzazione (a cascata membership, sessioni, inviti, clienti, fasi, importazioni, audit, token di recupero) e gli utenti rimasti senza altre membership; un utente ancora presente in un altro tenant o referenziato altrove viene **conservato**. Il registro attività del tenant viene eliminato con il tenant: archiviare la ricevuta JSON (conteggi e data) nel registro evidenze.

## 10. Capacità: risultato del test di carico (locale) e configurazione

Misure su PostgreSQL 16 locale con **30.000 clienti e ~62.000 eventi** per un tenant, ruolo runtime limitato, **su una macchina con 1 sola CPU condivisa tra database, applicazione e browser**: servono come ordine di grandezza, non come garanzia per un server reale.

| Endpoint | Mediana | Note |
|---|---|---|
| `/api/summary` | 187 ms | KPI e funnel |
| `/api/channels` · `/api/timeseries` | 109 · 119 ms | |
| `/api/segments` | 257 ms | |
| `/api/customers?limit=25` (pagina 1 · pagina 600) | 28 · 47 ms | |
| `/api/audit?limit=25` | 6 ms | |
| Export CSV (30.000 clienti, 4 MB) | 384 ms | |
| Export JSON (6,5 MB) | 326 ms | |

- **Concorrenza**: con 25 utenti simultanei (300 richieste) nessun errore, ma p50 3,0 s e p95 5,3 s (9 richieste/s): la CPU unica era saturata. I calcoli della dashboard sono rieseguiti a ogni richiesta (nessuna cache): su un server reale va rimisurato con più core e va valutato l'uso di cache o viste aggregate se i tenant crescono molto.
- **Limite per IP**: scatta alla richiesta 1201 in 15 minuti (confermato). Una pagina di dashboard usa ~6 richieste: molti utenti dietro **un solo IP aziendale (NAT)** possono raggiungerlo. Ora è configurabile con `API_RATE_LIMIT_MAX` (1–100000, predefinito 1200); `TRUSTED_PROXY_IPS` va impostato se l'app è dietro un proxy, altrimenti tutti gli utenti appaiono con l'IP del proxy.
- **Pool database**: ora configurabile con `DB_POOL_MAX` (1–50, predefinito 5). Su Neon rispettare il limite di connessioni del piano e usare l'endpoint pooler per l'app.
- Valori non validi nelle due variabili fanno **fallire l'avvio** con un messaggio chiaro (non vengono ignorati).

**Da fare su Neon/staging**: ripetere la misura con lo stesso dataset e almeno 2 vCPU, annotare p95 per 25 e 100 utenti simultanei e il consumo di compute.

## 11. Prestazioni del frontend

- **Prima**: il bundle JavaScript iniziale pesava 1.554 KB (479 KB compressi) e conteneva anche le librerie Excel e PDF, scaricate già alla schermata di login.
- **Dopo**: le librerie Excel (`xlsx`) e PDF (`jspdf`, `jspdf-autotable`) sono caricate **solo al click** su «Esporta Excel/PDF» o quando si carica un file `.xlsx/.xls`. Bundle iniziale: **698 KB (197 KB compressi), −55% / −59%**. Il resto si scarica al primo uso (xlsx 143 KB, jspdf 129 KB, autotable 10 KB compressi).
- Verificato in Chromium: download CSV, Excel (`.xlsx` valido) e PDF (`%PDF`) funzionanti; importazione di un file `.xlsx` riuscita; nessun errore in console; 53 test del client passati.
- Un errore di rete durante il caricamento on-demand mostra un avviso («Esportazione non riuscita…») invece di fallire in silenzio.
- **Ancora da fare**: il chunk principale resta sopra i 500 KB non compressi (grafici e viste). Se serve, caricare le viste meno usate con `React.lazy`; misurare con Lighthouse su dispositivo reale e rete lenta.

## 12. Prestazioni del database (piani di esecuzione)

Con 30.000 clienti e ~62.000 eventi la query più pesante della dashboard (conteggio clienti per fase) esegue in ~47 ms; il tempo cresce in modo lineare con i dati. L'indice su `events(organization_id, customer_id, stage_id)` **non è univoco**: i `COUNT(DISTINCT …)` sono quindi necessari e non vanno semplificati. Se un tenant supera alcune centinaia di migliaia di eventi: valutare una cache a breve scadenza o aggregati materializzati.

## 13. Revisione grafica e verifica di sicurezza (locale)

**Interfaccia**: palette ridotta (inchiostro, verde pino per ciò che converte, rosso garanza solo per le perdite), via le etichette in maiuscolo e le schede con icone colorate. La Panoramica apre con la frase sul passaggio in cui si perdono più clienti e disegna il funnel come flusso; un solo menu «Esporta» (CSV, Excel, PDF; accessibile da tastiera) sostituisce tre pulsanti per grafico; lo stato vuoto offre «Importa un file» e «Carica dati di esempio». Animazione unica (flusso che si disegna), disattivata con «riduci movimento». Tema chiaro e scuro, nessun overflow su mobile. Client: 16 file / 70 test.

**Sicurezza verificata**: `npm audit` del server senza vulnerabilità; nessuna query SQL costruita per concatenazione; nessun segreto nel codice; nessun `innerHTML`/`eval`; intestazioni (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, no-store, assenza di X-Powered-By); nessuna intestazione CORS per origini estranee; scritture con `Origin` estraneo respinte (403); errori generici senza dettagli interni; cookie di sessione HttpOnly/SameSite=Strict (`__Host-` e Secure in produzione); isolamento tra tenant con RLS e test negativi; CSP dell'esempio nginx senza script inline.
**Limiti dichiarati**: nessun test di penetrazione indipendente; `style-src 'unsafe-inline'` resta nella CSP per i grafici; la libreria Excel va tenuta alla versione 0.20.3 (quella del progetto, senza l'avviso noto della 0.18.x).
