# Customer Journey Dashboard

[![CI](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml)

Dashboard web per analizzare il **funnel di conversione** e il **customer journey**: dal primo contatto (visita) all'acquisto, passando per lead, qualificazione e opportunità. Permette di capire **dove si perdono i clienti** e **quali canali convertono meglio**.

> I dati sono **sintetici**: vengono generati automaticamente al primo avvio con un generatore pseudo-casuale deterministico. Non contengono informazioni reali di clienti o aziende.

## Funzionalità

- KPI principali: visite, lead, clienti, tasso di conversione visita → cliente, giorni medi all'acquisto
- Funnel a 5 stadi (Visita → Lead → Qualificato → Opportunità → Cliente) con la conversione di ogni passaggio
- Andamento mensile di visite e tasso di conversione
- Confronto tra canali (Organico, Social, Email, Advertising, Referral)
- Filtri per canale e per periodo (ultimi 3, 6, 12 mesi oppure intervallo di date personalizzato)
- Esportazione in CSV di funnel, andamento e confronto tra canali (compatibile con Excel in italiano)
- Gestione di caricamento, errori, intervallo di date non valido e periodo senza dati

## Stack

| Livello | Tecnologie |
| --- | --- |
| Front end | React 18, TypeScript, Vite, Recharts |
| Back end | Node.js, Express, TypeScript |
| Database | SQLite (better-sqlite3) con query SQL di aggregazione |
| Test | Vitest (query SQL e API REST), Testing Library (interfaccia React) |
| CI | GitHub Actions (test e build su Node 20 e 22) |

## Struttura

```
.
├── client/                 # Front end React
│   └── src/
│       ├── api.ts          # Chiamate HTTP tipizzate
│       ├── useAsync.ts     # Hook per il caricamento dati (con annullamento delle richieste)
│       ├── csv.ts          # Esportazione CSV
│       └── components/     # Filtri, KPI, funnel, andamento, tabella canali
├── server/                 # API REST
│   ├── src/
│   │   ├── db.ts           # Schema SQLite e connessione
│   │   ├── seed.ts         # Generazione dei dati sintetici
│   │   ├── queries.ts      # Query SQL di analisi (funnel, canali, serie storica)
│   │   └── app.ts          # Rotte Express, validazione e gestione errori
│   └── test/               # Test di query e API
└── docs/
    └── ARCHITETTURA.md     # Scelte progettuali e limiti
```

Le scelte progettuali (analisi per coorte, query SQL, validazione, test, limiti) sono spiegate in [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md).

### Come funziona l'analisi

Le analisi lavorano per **coorte**: si considerano i clienti la cui prima visita cade nel periodo scelto e si seguono i loro eventi lungo il funnel. Così le percentuali di conversione sono confrontabili tra periodi e canali.

## API

| Metodo e percorso | Descrizione |
| --- | --- |
| `GET /api/health` | Verifica che il server sia attivo |
| `GET /api/meta` | Intervallo di date disponibile e lista dei canali |
| `GET /api/summary?from&to&channel` | KPI e funnel |
| `GET /api/channels?from&to` | Confronto tra canali |
| `GET /api/timeseries?from&to&channel` | Andamento mensile |

I parametri `from` e `to` hanno formato `YYYY-MM-DD`. Valori non validi restituiscono `400` con un messaggio chiaro.

## Come avviarlo

Requisiti: Node.js 20 o superiore.

```bash
npm install
npm run dev
```

Poi apri http://localhost:5173. Il database `journey.db` viene creato e popolato al primo avvio.

### Versione di produzione

```bash
npm run build
npm start -w server
```

L'applicazione completa (API e interfaccia) è disponibile su http://localhost:3001.

### Test

```bash
npm test
```

## Come è stato realizzato

Il progetto è stato realizzato con l'assistenza di strumenti di intelligenza artificiale, usati per generare il codice iniziale, i test e la documentazione. Lo studio, lo eseguo, lo pubblico e lo estendo io: la cronologia dei commit mostra le modifiche successive.

## Possibili sviluppi

- Importazione di dati da CSV al posto di quelli sintetici
- Confronto tra due periodi
- Autenticazione e database PostgreSQL
- Test end-to-end con Playwright

## Licenza

MIT, vedi [LICENSE](LICENSE).
