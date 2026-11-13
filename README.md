# Percorso Cliente

Piattaforma web B2B per analizzare il percorso cliente, gestire le fasi del funnel e consultare i risultati per canale e periodo. Il database applicativo è **PostgreSQL**; l'isolamento dei dati è basato sull'organizzazione autenticata.

> **Stato:** il runtime HTTP PostgreSQL è l'unico runtime applicativo e l'avvio standard usa PostgreSQL. Il codice del vecchio database e le relative dipendenze sono stati rimossi dal ramo. Le migrazioni versionate e i test PostgreSQL sono presenti. Non è però possibile attestare da questo repository che le migrazioni siano già state applicate al database remoto Neon, né che eventuali dati precedenti siano stati trasferiti: il runtime rifiuta l'avvio se lo schema non coincide con le migrazioni attese. Il prodotto resta in fase di verifica e non va considerato pronto per dati aziendali reali o vendita prima del collaudo in staging, del backup/restore e delle verifiche operative.

## Funzioni

- Dashboard con KPI, funnel, andamento e confronto dei canali.
- Filtri temporali e per canale.
- Gestione clienti, eventi e fasi del percorso.
- Importazione CSV/Excel con validazione server-side.
- Segmentazione e confronto dei gruppi.
- Esportazione report CSV, Excel e PDF dal browser.
- Esportazione CSV clienti dal server, con autorizzazione dedicata e protezione da formule.
- Autenticazione, sessioni, ruoli e gestione dei membri dell'organizzazione.
- Audit log, rate limiting del login e controlli di sicurezza del runtime.

## Tecnologie

| Ambito | Tecnologie |
|---|---|
| Interfaccia | React, TypeScript, Vite, Recharts |
| Server | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| Driver | node-postgres (pg) |
| Test | Vitest, Testing Library, PostgreSQL 16 effimero |
| CI | GitHub Actions, Node.js 20 e 22 |

## Requisiti

- Node.js 20 o successivo
- npm
- Un database PostgreSQL
- Un ruolo proprietario/amministrativo per le migrazioni e il bootstrap
- Un ruolo applicativo non proprietario e senza privilegi elevati

## Configurazione locale

Copiare `.env.example` in `.env.local` e configurare i valori reali soltanto nel file locale, escluso dal versionamento:

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

4. Per un database vuoto, seguire [docs/BOOTSTRAP_POSTGRESQL.md](docs/BOOTSTRAP_POSTGRESQL.md) e creare la prima organizzazione con il comando esplicito:

```bash
npm run db:bootstrap -- --confirm-empty-database
```

Il bootstrap richiede una connessione amministrativa separata dal ruolo HTTP e rifiuta database già popolati. Non eseguirlo su un database che contiene dati senza aver prima verificato lo stato e il piano operativo.

## Avvio e verifiche

```bash
npm install
npm run dev
```

L'interfaccia è disponibile su [http://localhost:5173](http://localhost:5173); il server HTTP usa la porta 3001.

```bash
npm test
npm run build
```

La CI esegue test e build su Node.js 20 e 22, usando un database PostgreSQL temporaneo. Questo verifica il codice, non lo stato del database remoto.

## Sicurezza e rilascio

- L'organizzazione viene ricavata dalla sessione verificata, non da parametri inviati dal browser.
- Le operazioni applicative sono tenant-scoped e le tabelle operative usano Row-Level Security.
- Il ruolo HTTP deve essere distinto dal proprietario dello schema e non deve essere superuser o avere BYPASSRLS.
- Le migrazioni sono versionate, controllate tramite checksum e protette da advisory lock.
- L'avvio verifica lo storico migrazioni e i privilegi; non modifica lo schema.
- Il server applica controlli di origine, cookie protetti, limiti alle richieste e risposte senza cache.
- I dati dimostrativi non vengono creati automaticamente.

Prima di un rilascio reale sono ancora obbligatori: verifica dello storico sul database remoto, prova di backup e ripristino, collaudo browser end-to-end, verifica di isolamento tra organizzazioni, monitoraggio, test di carico e staging con dati sintetici.

## Documentazione

La cartella `docs/` contiene architettura, modello dati, decisioni, procedure di bootstrap e migrazione, inventario API e registro delle verifiche.

## Licenza

MIT. Consultare [LICENSE](LICENSE).
