# Installazione locale — Percorso Cliente

Questa procedura prepara un'istanza di sviluppo/dimostrazione su un singolo computer. Non pubblica il servizio su Internet e non configura un ambiente per dati aziendali reali.

## 1. Prerequisiti

- Node.js 22, 24 o 26 LTS e npm.
- `NODE_ENV=development` in locale; usare esclusivamente `NODE_ENV=production` in staging/produzione.
- PostgreSQL 16 in esecuzione sul computer.
- Git.
- Accesso al repository GitHub.

Verificare:

```bash
node --version
npm --version
psql --version
```

## 2. Scaricare il codice

Clonare il repository e passare al ramo di integrazione in cui sono raccolte le modifiche in revisione:

```bash
git clone https://github.com/saales/customer-journey-dashboard.git
cd customer-journey-dashboard
git fetch origin
git checkout integration/staging-additions-hardening
npm ci
```

Il ramo è una base di collaudo, non una release stabile. Non usare `main` come se contenesse già tutte le modifiche della PR.

## 3. Preparare PostgreSQL

Creare un database locale dedicato, ad esempio `percorso_local`, e due ruoli distinti:
- un ruolo amministrativo/proprietario, usato solo per migrazioni e bootstrap;
- un ruolo applicativo non proprietario, `NOINHERIT`, senza `SUPERUSER`, `BYPASSRLS`, `CREATEDB` o `CREATEROLE`.

Non riutilizzare l'account superuser di PostgreSQL come connessione del server web. Seguire la procedura di provisioning dei privilegi runtime descritta nei file SQL delle migrazioni e nella documentazione PostgreSQL del progetto. Se non si è certi dei privilegi, fermarsi e chiedere una verifica: non concedere `ALL PRIVILEGES` al ruolo applicativo.

## 4. Configurare le variabili locali

Copiare il modello:

```bash
cp .env.example .env.local
```

Su Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Impostare `NODE_ENV=development` per lo sviluppo locale. Per staging e produzione impostare esplicitamente `NODE_ENV=production`: il server rifiuta l’avvio se la variabile manca o contiene un valore non supportato, così le protezioni HTTPS e cookie Secure non dipendono da un default implicito.

Per applicare le migrazioni, impostare temporaneamente `DATABASE_URL` con il ruolo amministrativo e il database locale. Usare inoltre `BOOTSTRAP_DATABASE_URL` e `BOOTSTRAP_CONFIRM_DATABASE` per il bootstrap iniziale, insieme a nome organizzazione, slug, email amministratore e password iniziale. Questi valori devono rimanere solo in `.env.local`, mai in Git.

Generare un segreto casuale di almeno 32 caratteri per `LOGIN_RATE_LIMIT_SECRET`. Per la prima installazione locale usare un'origine `APP_ORIGIN=http://localhost:5173`. Lasciare vuote entrambe le variabili Resend se non si configura l'email.

## 5. Applicare e verificare le migrazioni

Con `DATABASE_URL` impostato sul ruolo amministrativo e dopo aver verificato che il database sia quello locale:

```bash
npm run db:migrate -- --check
npm run db:migrate
npm run db:migrate -- --check
```

Il primo comando è un preflight in sola lettura; il secondo applica le migrazioni. Non eseguire questi comandi contro un database remoto o di produzione senza backup verificato, approvazione e piano di ripristino.

## 6. Creare il primo tenant dimostrativo

Impostare i parametri `BOOTSTRAP_*` richiesti nel file locale e lanciare:

```bash
npm run db:bootstrap -w server -- --confirm-empty-database
```

Il bootstrap è destinato esclusivamente a un database vuoto. Rifiuta un database già popolato. La password iniziale non viene stampata: conservarla in un gestore credenziali. Rimuovere le variabili di bootstrap dopo l'operazione.

## 7. Avviare il server con il ruolo runtime

Prima di avviare l'applicazione, sostituire `DATABASE_URL` in `.env.local` con la connessione del ruolo runtime non proprietario. Verificare che il ruolo abbia solo i privilegi richiesti e che TLS sia attivo quando si usa un database remoto.

Poi eseguire:

```bash
npm run dev
```

Aprire:
- Interfaccia: http://localhost:5173
- API health: http://localhost:3001/api/health

Il server controlla all'avvio lo storico migrazioni e la sicurezza del ruolo; se i controlli falliscono, non parte.

## 8. Eseguire i test

```bash
npm test
npm run build
npm run db:verify-readonly -w server -- --expect-database percorso_local --allow-no-ssl
```

Il verificatore read-only controlla identità del database, TLS, tabelle, policy RLS e relativi predicati tenant, privilegi del ruolo runtime e checksum delle migrazioni. In locale `--allow-no-ssl` trasforma l'assenza di TLS in avviso; per staging/produzione non usare questa opzione. Il comando non applica migrazioni e non legge righe applicative.

I test d'integrazione PostgreSQL richiedono un database di test dedicato configurato secondo le variabili lette da `server/test/helpers/http-test-environment.ts`. Non puntare mai i test a un database contenente dati reali.

## 9. Limiti della modalità locale

- L'applicazione è raggiungibile dal computer locale; non è una pubblicazione Internet.
- Non usare dati personali o commerciali reali nella demo.
- L'email transazionale richiede configurazione Resend e dominio mittente verificato.
- Questa procedura non sostituisce il collaudo staging, le prove backup/restore, la revisione di sicurezza, la valutazione GDPR o il piano di continuità.
- Il ramo di integrazione e la PR restano in revisione fino al completamento dei test mancanti.
