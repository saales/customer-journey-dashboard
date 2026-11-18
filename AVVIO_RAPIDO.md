# Avvio rapido in locale (10 minuti)

Requisiti: Node.js 22+ e PostgreSQL 16 con `psql` (versione usata nelle verifiche automatizzate). Tutti i comandi dalla cartella del progetto.

## 1. Database
```bash
# come utente amministratore di PostgreSQL (es. postgres)
psql -c "CREATE DATABASE percorso"
psql -c "CREATE ROLE percorso_app LOGIN PASSWORD 'scegli-una-password' NOINHERIT"
```
Il ruolo `percorso_app` è quello usato dall'applicazione (non privilegiato, con isolamento per tenant). Il nome è fisso perché le migrazioni gli assegnano i permessi.

## 2. Installazione e configurazione
```bash
npm ci
cp .env.example .env.local
```
Modifica `.env.local`:
```
DATABASE_URL=postgresql://percorso_app:scegli-una-password@localhost:5432/percorso?sslmode=disable
APP_ORIGIN=http://localhost:5173
LOGIN_RATE_LIMIT_SECRET=<almeno 32 caratteri casuali>
PORT=3001
```

## 3. Tabelle e primo accesso (con un utente amministratore di PostgreSQL)
```bash
export OWNER=postgresql://postgres:<password-postgres>@localhost:5432/percorso
DATABASE_URL=$OWNER npm run db:migrate
BOOTSTRAP_DATABASE_URL=$OWNER BOOTSTRAP_CONFIRM_DATABASE=percorso \
BOOTSTRAP_ORGANIZATION_NAME="La Mia Azienda" BOOTSTRAP_ORGANIZATION_SLUG=mia-azienda \
BOOTSTRAP_ADMIN_EMAIL=tu@esempio.it BOOTSTRAP_ADMIN_NAME="Il Tuo Nome" \
BOOTSTRAP_ADMIN_PASSWORD='una-password-lunga-e-sicura' \
npm run db:bootstrap -- --confirm-empty-database
```

## 4. Avvio
```bash
npm run dev
```
Apri **http://localhost:5173** (usa proprio `localhost`, come in `APP_ORIGIN`) e accedi con email, password e codice organizzazione (`mia-azienda`).
Per caricare dati di prova: sezione «Importazione dati» (CSV con colonne `externalId,channel,createdAt,stage,occurredAt`).

## 5. Verifiche
```bash
npm test                       # test del client e del server (i test di integrazione richiedono DATABASE_URL locale)
npm run build                  # compila server e client
```
Con `DATABASE_URL` locale la suite server crea e rimuove database e ruoli temporanei; non puntarla a un servizio remoto. Se la variabile manca, i test d'integrazione PostgreSQL vengono saltati. La suite browser richiede Chromium e il database/tenant sintetico predisposti nella pipeline CI (`.github/workflows/ci.yml`). Collaudo su Neon/staging, backup e ripristino: `docs/GUIDA_COLLAUDO_NEON.md` e `docs/COLLAUDO_STAGING_BACKUP_RIPRISTINO.md`.
