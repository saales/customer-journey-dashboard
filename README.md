# Percorso Cliente

Piattaforma web B2B per analizzare il percorso cliente, gestire le fasi del funnel e consultare i risultati per canale e periodo. PostgreSQL è l'unico database applicativo; l'organizzazione viene ricavata dalla sessione autenticata.

> **Stato:** il runtime HTTP standard usa esclusivamente PostgreSQL. Il codice, le dipendenze e i test del vecchio database sono stati rimossi dal ramo. Le migrazioni versionate 001–010 e i test PostgreSQL sono presenti. Non è però possibile attestare da questo repository che le migrazioni siano già state applicate al database remoto Neon o che eventuali dati precedenti siano stati trasferiti: il runtime si arresta se lo schema non coincide con le migrazioni attese. Il prodotto resta in fase di verifica e non va considerato pronto per dati aziendali reali o vendita prima del collaudo in staging, del backup/restore e delle verifiche operative.

## Funzioni

- Dashboard con KPI, funnel, andamento e confronto dei canali.
- Filtri temporali e per canale.
- Gestione clienti, eventi e fasi del percorso.
- Importazione CSV/Excel con validazione server-side.
- Segmentazione e confronto dei gruppi.
- Esportazione report CSV, Excel e PDF dal browser.
- Esportazione CSV clienti dal server, tenant-scoped e protetta da permesso.
- Autenticazione, sessioni, ruoli e gestione dei membri.
- Inviti monouso con scadenza, revoca e accettazione atomica; il collegamento viene condiviso manualmente, non inviato via email.
- Audit log, rate limiting persistente e condiviso per login e API, e controlli di sicurezza del runtime.

## Tecnologie

| Ambito | Tecnologie |
|---|---|
| Interfaccia | React, TypeScript, Vite, Recharts |
| Server | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| Driver | node-postgres (pg) |
| Test | Vitest, Testing Library, PostgreSQL 16 temporaneo |
| CI | GitHub Actions, Node.js 20 e 22 |

## Requisiti

- Node.js 20 o successivo
- npm
- Un database PostgreSQL
- Un ruolo proprietario/amministrativo per migrazioni e bootstrap
- Un ruolo applicativo non proprietario, NOINHERIT e senza privilegi elevati

## Configurazione locale

Copiare `.env.example` in `.env.local` e configurare i valori reali solo nel file locale, escluso dal versionamento:

```dotenv
DATABASE_URL=postgresql://utente_app:password@host:5432/database?sslmode=require
APP_ORIGIN=http://localhost:5173
LOGIN_RATE_LIMIT_SECRET=una-stringa-casuale-di-almeno-32-caratteri
PORT=3001
```

Non inserire credenziali o stringhe di connessione nei file versionati, nei ticket o nei log.

## Migrazioni e bootstrap

Le migrazioni sono esplicite e non vengono applicate automaticamente all'avvio del server.

1. Verificare l'identità del database e il ruolo amministrativo.
2. Eseguire il preflight in sola lettura:

```bash
npm run db:migrate -- --check
```

3. Solo dopo aver verificato backup, destinazione e piano di ripristino, applicare le migrazioni:

```bash
npm run db:migrate
```

4. Per un database vuoto, seguire [docs/BOOTSTRAP_POSTGRESQL.md](docs/BOOTSTRAP_POSTGRESQL.md):

```bash
npm run db:bootstrap -- --confirm-empty-database
```

Il bootstrap rifiuta database già popolati. Non usarlo per ricreare tenant esistenti.

## Avvio e verifiche

```bash
npm ci
npm run dev
```

L'interfaccia è disponibile su [http://localhost:5173](http://localhost:5173); il server HTTP usa la porta 3001.

```bash
npm test
npm run build
```

La CI applica le migrazioni a un PostgreSQL temporaneo, verifica checksum e avvia il server con il ruolo applicativo limitato. Sul runtime Node.js 22 esegue inoltre test browser end-to-end con Playwright/Chromium su un'organizzazione effimera: login amministratore, creazione cliente, configurazione funnel, import CSV, export CSV, invito e accettazione di un analista e rifiuto server-side di una scrittura non autorizzata. Il database usato da questi test viene creato nel servizio PostgreSQL temporaneo della CI e non è il database remoto. Questo non dimostra lo stato del database remoto.

## Sicurezza e rilascio

- L'organizzazione deriva dalla sessione verificata, non da parametri del browser.
- Le API e i repository applicano filtri tenant-scoped; le tabelle operative applicano RLS.
- Il ruolo HTTP non è proprietario, superuser o BYPASSRLS e non eredita privilegi.
- Le migrazioni sono versionate, verificate tramite checksum e protette da advisory lock.
- Lo startup controlla lo storico migrazioni e i privilegi; non modifica lo schema.
- Le scritture richiedono Origin autorizzato; i cookie sono HttpOnly e SameSite=Strict.
- Gli inviti sono monouso, con token hashato nel database e scadenza; l'email automatica non è configurata.

La pulizia dei bucket di rate limiting per login e API è disponibile con `npm run db:cleanup-login-attempts` e va pianificata giornalmente. Dietro reverse proxy, configurare `TRUSTED_PROXY_IPS` con i soli indirizzi/CIDR fidati.

Prima di un rilascio reale sono obbligatori: verifica dello storico remoto, prova di backup e ripristino, completamento della matrice browser per i ruoli e dei test cross-tenant, monitoraggio, test di carico e staging con dati sintetici. La CI copre già un percorso browser rappresentativo admin/analista, non l'intera matrice di autorizzazione.

## Documentazione

La cartella `docs/` contiene architettura, modello dati, procedure di bootstrap, distribuzione, migrazioni e registro delle verifiche.

## Licenza

MIT. Consultare [LICENSE](LICENSE).
