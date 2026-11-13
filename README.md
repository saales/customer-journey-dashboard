# Customer Journey Dashboard

Dashboard web per analizzare il **funnel di conversione** e il **customer journey**: dal primo contatto (visita) all'acquisto, passando per contatto, qualificazione e opportunità.

Il progetto permette di monitorare le performance del percorso di conversione, individuare i punti di abbandono e confrontare l'efficacia dei diversi canali di acquisizione. **Nota sullo stato:** il backend attualmente esegue ancora su SQLite; PostgreSQL, autenticazione e isolamento multi-tenant non sono ancora completati e verificati per la produzione.

[![CI](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml)

> **Dati dimostrativi:** il generatore crea dati sintetici esclusivamente quando viene abilitato esplicitamente con `ALLOW_DEMO_SEED=true` in un ambiente non di produzione. Il server non inserisce dati dimostrativi automaticamente e rifiuta l'opzione in `NODE_ENV=production`. Non usare dati sintetici come dati aziendali reali.

## Funzionalità

- **Panoramica KPI:** visite iniziali, contatti acquisiti, clienti, tasso di conversione e giorni medi all'acquisto.
- **Funnel di conversione:** analisi delle cinque fasi del percorso (Visita → Contatto → Qualificato → Opportunità → Cliente), con percentuali di conversione tra le fasi.
- **Andamento mensile:** visualizzazione dell'evoluzione delle visite e del tasso di conversione.
- **Confronto tra canali:** analisi delle performance di Organico, Social, Email, Pubblicità e Passaparola.
- **Filtri interattivi:** selezione del periodo e del canale, con intervalli temporali predefiniti o personalizzati.
- **Gestione clienti:** inserimento, modifica ed eliminazione dei clienti, con registrazione delle date associate alle diverse fasi del percorso.
- **Esportazione CSV:** download dei dati relativi a funnel, andamento mensile e confronto tra canali, compatibile con Excel in italiano.
- **Interfaccia moderna:** navigazione laterale, tema chiaro e scuro e layout adattabile alle diverse dimensioni dello schermo.
- **Gestione degli stati:** feedback durante il caricamento, segnalazione degli errori e gestione dei periodi senza dati.
- **Paginazione clienti:** caricamento progressivo dei record con pagina e dimensione configurabili, totale risultati e navigazione tra pagine.
- **Organizzazioni vuote:** le viste analytics gestiscono correttamente l'assenza di dati, senza richiedere un seed dimostrativo.

## Stack tecnologico

| Livello | Tecnologie |
|---|---|
| Frontend | React 18, TypeScript, Vite, Recharts, Lucide React |
| Backend | Node.js, Express, TypeScript |
| Database attuale | SQLite con better-sqlite3 e query SQL di aggregazione |
| Test | Vitest, Testing Library |
| CI | GitHub Actions, test e build su Node.js 20 e 22 |

## Struttura del progetto

```text
.
├── client/
│   └── src/
│       ├── components/
│       │   ├── AppLayout.tsx
│       │   ├── KpiCards.tsx
│       │   ├── FunnelChart.tsx
│       │   ├── TrendChart.tsx
│       │   ├── ChannelTable.tsx
│       │   ├── Filters.tsx
│       │   └── CustomerManagement.tsx
│       ├── api.ts
│       ├── useAsync.ts
│       ├── csv.ts
│       └── styles.css
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── db.ts
│   │   ├── seed.ts
│   │   ├── seed-cli.ts
│   │   └── queries.ts
│   └── test/
├── docs/
│   └── ARCHITETTURA.md
├── package.json
├── README.md
└── LICENSE
```

Le scelte progettuali, l'analisi per coorte, le query SQL, la validazione e i limiti dell'applicazione sono approfonditi nel documento [Architettura e scelte progettuali](docs/ARCHITETTURA.md).

## Come funziona l'analisi

Le analisi lavorano per **coorte**: vengono considerati i clienti la cui prima visita ricade nel periodo selezionato e vengono seguiti i relativi eventi lungo il funnel.

Questo approccio permette di confrontare le percentuali di conversione tra periodi e canali, mantenendo coerente il criterio di analisi.

## API

Le API REST consentono di consultare i dati e gestire le anagrafiche dei clienti.

| Metodo e percorso | Descrizione |
|---|---|
| `GET /api/health` | Verifica che il server sia attivo |
| `GET /api/meta` | Recupera l'intervallo di date disponibile e la lista dei canali |
| `GET /api/summary?from&to&channel` | Recupera KPI e dati del funnel |
| `GET /api/channels?from&to` | Recupera il confronto tra canali |
| `GET /api/timeseries?from&to&channel` | Recupera l'andamento mensile |
| `GET /api/customers?page=1&limit=50` | Recupera una pagina di clienti con metadati di paginazione (limite massimo 100) |
| `POST /api/customers` | Inserisce un nuovo cliente |
| `PUT /api/customers/:id` | Modifica i dati di un cliente |
| `DELETE /api/customers/:id` | Elimina un cliente |

I parametri `from` e `to` utilizzano il formato `YYYY-MM-DD`. I valori non validi restituiscono una risposta HTTP `400` con un messaggio descrittivo. L'endpoint clienti restituisce un oggetto con `data` e `pagination` (`page`, `limit`, `total`, `totalPages`); `page` parte da 1 e `limit` vale 50 per impostazione predefinita, con massimo 100.

## Come avviarlo

### Requisiti

- Node.js 20 o superiore
- npm

### Avvio in modalità sviluppo

Dalla cartella principale del progetto:

```bash
npm install
npm run dev
```

Il comando avvia contemporaneamente il server API e l'interfaccia web.

Aprire nel browser:

[http://localhost:5173](http://localhost:5173)

Il database SQLite (`journey.db`) viene creato e popolato automaticamente al primo avvio, utilizzando dati sintetici.

### Build e avvio in produzione

Per compilare frontend e backend:

```bash
npm run build
```

Per avviare il server:

```bash
npm start -w server
```

L'applicazione completa è disponibile all'indirizzo:

[http://localhost:3001](http://localhost:3001)

### Test automatici

Per eseguire i test di entrambi i workspace:

```bash
npm test
```

### Generazione manuale dei dati sintetici

```bash
npm run seed
```

## Sviluppo del progetto

Ho realizzato questo progetto attraverso un percorso progressivo di analisi, progettazione, sviluppo e verifica.

Durante il lavoro mi sono concentrato sulla comprensione delle logiche del customer journey, sulla modellazione dei dati e sulla realizzazione di un'applicazione capace di rappresentare in modo chiaro le diverse fasi del percorso di conversione.

Ho lavorato sull'integrazione tra frontend e backend, sulla gestione dei dati tramite database SQLite, sulla progettazione delle API e sulla realizzazione di funzionalità di analisi e gestione dei clienti.

Una parte importante del lavoro ha riguardato anche il miglioramento dell'esperienza utente, la leggibilità delle informazioni, la gestione degli errori e la verifica del funzionamento attraverso test automatici.

Il progetto rappresenta un'esperienza pratica di applicazione delle competenze informatiche a un caso d'uso orientato all'analisi dei processi aziendali.

## Possibili sviluppi

- **Integrazione dei dati aziendali:** possibilità di importare dataset tramite CSV.
- **Analisi comparativa:** confronto tra periodi temporali e performance dei diversi canali.
- **Approfondimento del funnel:** analisi dei tassi di abbandono e dei punti critici del percorso di conversione.
- **Evoluzione dell'architettura:** migrazione effettiva a PostgreSQL, autenticazione, sessioni e isolamento multi-tenant (non ancora completati nel branch corrente).
- **Estensione dei test:** test end-to-end per verificare i principali flussi di utilizzo.

## Licenza

Licenza MIT. Consulta il file [LICENSE](LICENSE).