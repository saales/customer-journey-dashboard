# Percorso Cliente

Piattaforma web B2B per analizzare il percorso cliente, gestire le fasi del funnel e consultare i risultati per canale e periodo. PostgreSQL è l'unico database applicativo; l'organizzazione viene ricavata dalla sessione autenticata.

> **Stato al 18 novembre 2026:** il runtime HTTP standard usa esclusivamente PostgreSQL. Le migrazioni 001–013 sono applicate e verificate sul branch Neon di staging; il ruolo runtime limitato e le policy RLS sono stati verificati. Il servizio Render staging è attivo e le funzionalità principali sono state provate manualmente con dati sintetici. La CI sul commit `69d14d9` è verde su Node.js 22 e 24: test automatici, build, migrazioni e checksum PostgreSQL, avvio con ruolo runtime limitato; i test browser Playwright sono superati nel job Node.js 22. L'audit bloccante delle dipendenze runtime è superato; restano segnalate vulnerabilità nelle dipendenze di sviluppo, non dichiarate risolte. È stato eseguito un backup logico locale dello staging e il ripristino è stato verificato su un'istanza PostgreSQL 18 locale isolata: 14 tabelle ripristinate e conteggi verificati per clienti, eventi, organizzazioni, utenti e audit log. I controlli manuali di accessibilità da tastiera coprono login e dashboard e sono in corso sulle altre schermate; non costituiscono un audit WCAG. Il progetto è adatto a portfolio/CV e come base tecnica per una tesi, dichiarando i limiti; **non è approvato per produzione con dati aziendali reali**, perché la consegna email non è verificata, il test di carico controllato non è stato eseguito, l'audit indipendente e la copertura esaustiva cross-tenant restano aperti.

## Funzioni

- Dashboard con KPI, funnel, andamento e confronto dei canali.
- Filtri temporali e per canale.
- Gestione clienti, eventi e fasi del percorso.
- Importazione CSV/Excel con validazione server-side.
- Segmentazione e confronto dei gruppi.
- Esportazione report CSV, Excel e PDF dal browser.
- Esportazione CSV clienti dal server, tenant-scoped, protetta da permesso e registrata nell'audit log.
- Autenticazione, sessioni, ruoli e gestione dei membri.
- Inviti monouso con scadenza, revoca e accettazione atomica, con invio automatico tramite Resend quando configurato.
- Recupero password con token monouso hashati, scadenza di 30 minuti, invio email e revoca di tutte le sessioni esistenti.
- Impostazioni account: modifica del nome, cambio password con verifica della password attuale e revoca di tutte le sessioni.
- Impostazioni organizzazione: visualizzazione e modifica del nome da parte degli amministratori, con audit log.
- Audit log, rate limiting persistente e condiviso per login e API, e controlli di sicurezza del runtime.

## Tecnologie

| Ambito | Tecnologie |
|---|---|
| Interfaccia | React, TypeScript, Vite, Recharts |
| Server | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| Driver | node-postgres (pg) |
| Test | Vitest, Testing Library, PostgreSQL 16 temporaneo |
| CI | GitHub Actions, Node.js 22 e 24 (Playwright su Node.js 22) |

## Requisiti

- Node.js 22 o successivo (la CI verifica Node.js 22 e 24)
- npm
- PostgreSQL 16 (versione usata nelle verifiche automatizzate)
- Un ruolo proprietario/amministrativo per migrazioni e bootstrap
- Un ruolo applicativo non proprietario, NOINHERIT e senza privilegi elevati

## Configurazione locale

Copiare `.env.example` in `.env.local` e configurare i valori reali solo nel file locale, escluso dal versionamento:

```dotenv
DATABASE_URL=postgresql://percorso_app:password@host:5432/database?sslmode=verify-full
APP_ORIGIN=http://localhost:5173
LOGIN_RATE_LIMIT_SECRET=una-stringa-casuale-di-almeno-32-caratteri
RESEND_API_KEY= # opzionale
EMAIL_FROM= # opzionale; configurare insieme a RESEND_API_KEY
HOST=127.0.0.1
PORT=3001
```

Non inserire credenziali o stringhe di connessione nei file versionati, nei ticket o nei log.
Per un database remoto usare `sslmode=verify-full`, che richiede TLS e verifica certificato e nome host. `sslmode=disable` è adatto solo allo sviluppo locale. In produzione il server si arresta se un database remoto non usa `verify-full`.

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

L'interfaccia è disponibile su [http://localhost:5173](http://localhost:5173); il server HTTP usa la porta 3001 ed è raggiungibile dal solo host (`HOST=127.0.0.1`).

```bash
npm test
npm run build
```

Con `DATABASE_URL` puntato a PostgreSQL locale, `npm test` esegue anche le prove d'integrazione: queste creano e rimuovono database e ruoli temporanei. Non usare un database remoto. Senza `DATABASE_URL`, le prove che richiedono PostgreSQL vengono saltate. I risultati raccolti in locale sono in [docs/VERIFICA_LOCALE.md](docs/VERIFICA_LOCALE.md).

La CI applica le migrazioni 001–013 a un PostgreSQL temporaneo, verifica checksum e avvia il server con il ruolo applicativo limitato. Su Node.js 22 esegue test browser Playwright/Chromium per admin, analyst, viewer ed editor, inclusi creazione cliente, configurazione funnel, import/export CSV, inviti, accettazione e verifica permessi. Il test crea anche un secondo tenant e controlla alcuni casi di isolamento API per clienti, fasi funnel, export e audit. La copertura cross-tenant completa di tutte le API non è ancora dimostrata. Il database dei test è PostgreSQL temporaneo CI, non il database remoto. Per eseguire localmente i test browser servono Chromium e il database/tenant sintetico predisposti come nella pipeline CI (`.github/workflows/ci.yml`).

## Sicurezza e rilascio

- L'organizzazione deriva dalla sessione verificata, non da parametri del browser.
- Le API e i repository applicano filtri tenant-scoped; le tabelle operative applicano RLS.
- Il ruolo HTTP non è proprietario, superuser o BYPASSRLS e non eredita privilegi.
- Le migrazioni sono versionate, verificate tramite checksum e protette da advisory lock.
- Lo startup controlla lo storico migrazioni e i privilegi; non modifica lo schema.
- Le scritture richiedono Origin autorizzato; i cookie sono HttpOnly e SameSite=Strict.
- Gli inviti e i reset password usano token monouso, memorizzati solo come hash e con scadenza.
- Le password usano scrypt `N=32768, r=8, p=3` con salt casuale; gli hash precedenti restano verificabili e vengono aggiornati al login riuscito.
- I nuovi link per inviti e recupero collocano il token nel frammento URL, non nella richiesta HTTP; l'interfaccia lo rimuove subito dalla barra degli indirizzi e supporta ancora i link precedenti.
- Il cambio password richiede la password attuale, aggiorna le credenziali in transazione e revoca tutte le sessioni.
- Le email transazionali usano Resend; configurare `RESEND_API_KEY` e `EMAIL_FROM`. Senza configurazione, gli inviti restano condivisibili manualmente e il recupero password non può inviare istruzioni.
- Il server API ascolta su `127.0.0.1` per default. Se un reverse proxy è in un container o su un altro host, impostare `HOST` sull'indirizzo interno necessario e impedire l'accesso diretto dalla rete pubblica.

La pulizia dei bucket di rate limiting per login e API è disponibile con `npm run db:cleanup-login-attempts` e va pianificata giornalmente. Dietro reverse proxy, configurare `TRUSTED_PROXY_IPS` con i soli indirizzi/CIDR fidati.

Prima di un rilascio reale sono obbligatori: una procedura di backup periodico con conservazione sicura e prova di ripristino sul database di destinazione, ulteriori test cross-tenant per tutte le combinazioni route/ruolo/tenant, monitoraggio, test di carico, verifica della consegna email se abilitata e revisione indipendente. La prova locale del 18 novembre 2026 dimostra la leggibilità e il ripristino dell'archivio logico su PostgreSQL 18, ma non configura backup automatici né disaster recovery del servizio remoto. Il branch Neon di staging è stato verificato e i flussi principali sono stati collaudati manualmente con dati sintetici; la CI copre un percorso browser rappresentativo, non l'intera matrice di autorizzazione. Il database e il servizio production non sono stati modificati né approvati per il rilascio.

## Documentazione

La cartella `docs/` contiene architettura, modello dati, procedure di bootstrap, distribuzione, migrazioni e risultati delle verifiche locali.

## Licenza

MIT. Consultare [LICENSE](LICENSE).
