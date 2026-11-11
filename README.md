# Customer Journey Dashboard

Dashboard web per analizzare il **funnel di conversione** e il **customer journey**: dal primo contatto (visita) all'acquisto, passando per contatto, qualificazione e opportunità.

Permette di monitorare le performance del percorso di conversione, individuare i punti di abbandono e confrontare l'efficacia dei diversi canali di acquisizione.

[![CI](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml)

> **Dati dimostrativi:** il progetto utilizza dati sintetici, generati automaticamente al primo avvio. Non contiene informazioni reali di clienti o aziende.

## Funzionalità

- **Panoramica KPI:** visite iniziali, contatti acquisiti, clienti, tasso di conversione e giorni medi all'acquisto.
- **Funnel di conversione:** analisi delle 5 fasi del percorso (Visita → Contatto → Qualificato → Opportunità → Cliente), con percentuali di conversione tra le fasi.
- **Andamento mensile:** visualizzazione dell'evoluzione delle visite e del tasso di conversione.
- **Confronto tra canali:** analisi delle performance di Organico, Social, Email, Pubblicità e Passaparola.
- **Filtri interattivi:** selezione del periodo e del canale, con intervalli temporali predefiniti o personalizzati.
- **Gestione clienti:** inserimento, modifica ed eliminazione dei clienti, con registrazione delle date associate alle diverse fasi del percorso.
- **Esportazione CSV:** download dei dati relativi a funnel, andamento mensile e confronto tra canali, compatibile con Excel in italiano.
- **Interfaccia moderna:** navigazione laterale, tema chiaro e scuro e layout adattabile alle diverse dimensioni dello schermo.
- **Gestione degli stati:** feedback durante il caricamento, segnalazione degli errori e gestione dei periodi senza dati.

## Stack tecnologico

| Livello | Tecnologie |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Recharts, Lucide React |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite con better-sqlite3 e query SQL di aggregazione |
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
│   │   ├── db.ts
│   │   ├── seed.ts
│   │   ├── queries.ts
│   │   └── app.ts
│   └── test/
└── docs/
    └── ARCHITETTURA.md
```

Le scelte progettuali, l'analisi per coorte, le query SQL, la validazione e i limiti dell'applicazione sono approfonditi in [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md).

## Come funziona l'analisi

Le analisi lavorano per **coorte**: vengono considerati i clienti la cui prima visita ricade nel periodo selezionato e vengono seguiti i relativi eventi lungo il funnel.

Questo approccio permette di confrontare le percentuali di conversione tra periodi e canali, mantenendo coerente il criterio di analisi.

## API

| Metodo e percorso | Descrizione |
| --- | --- |
| `GET /api/health` | Verifica che il server sia attivo |
| `GET /api/meta` | Intervallo di date disponibile e lista dei canali |
| `GET /api/summary?from&to&channel` | KPI e funnel |
| `GET /api/channels?from&to` | Confronto tra canali |
| `GET /api/timeseries?from&to&channel` | Andamento mensile |
| `| `GET /api/customers` | Recupera l'elenco dei clienti |
| `POST /api/customers` | Inserisce un nuovo cliente |
| `PUT /api/customers/:id` | Modifica i dati di un cliente |
| `DELETE /api/customers/:id` | Elimina un cliente | | Gestione dei dati cliente |

I parametri `from` e `to` utilizzano il formato `YYYY-MM-DD`. I valori non validi restituiscono una risposta HTTP `400` con un messaggio descrittivo.


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

http://localhost:5173

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

http://localhost:3001

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

Il progetto è stato sviluppato attraverso un percorso di analisi, sperimentazione e miglioramento progressivo, con il supporto di strumenti di intelligenza artificiale.

Il lavoro ha riguardato la comprensione delle logiche di analisi del customer journey, la progettazione della struttura applicativa, la gestione dei dati, la realizzazione e il miglioramento dell'interfaccia e la verifica del funzionamento tramite test automatici.

Particolare attenzione è stata dedicata alla leggibilità delle informazioni, alla coerenza dei dati e alla facilità di utilizzo della dashboard.

## Possibili sviluppi

- **Integrazione dei dati aziendali:** possibilità di importare dataset tramite CSV.
- **Analisi comparativa:** confronto tra periodi temporali e performance dei diversi canali.
- **Approfondimento del funnel:** analisi dei tassi di abbandono e dei punti critici del percorso di conversione.
- **Evoluzione dell'architettura:** introduzione di autenticazione e database PostgreSQL.
- **Estensione dei test:** test end-to-end per verificare i principali flussi di utilizzo.

## Licenza

Licenza MIT. Consulta il file [LICENSE](LICENSE).