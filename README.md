# Customer Journey Dashboard

Dashboard web per analizzare il **funnel di conversione** e il **customer journey**: dal primo contatto (visita) all'acquisto, passando per lead, qualificazione e opportunità. Permette di capire **dove si perdono i clienti** e **quali canali convertono meglio**.

> I dati sono **sintetici**: vengono generati automaticamente al primo avvio con un generatore pseudo-casuale deterministico. Non contengono informazioni reali di clienti o aziende.

## Funzionalità

- KPI principali: visite, lead, clienti, tasso di conversione visita → cliente, giorni medi all'acquisto
- Funnel a 5 stadi (Visita → Lead → Qualificato → Opportunità → Cliente) con la conversione di ogni passaggio
- Andamento mensile di visite e tasso di conversione
- Confronto tra canali (Organico, Social, Email, Advertising, Referral)
- Filtri per periodo (3, 6, 12 mesi) e per canale
- Gestione di caricamento ed errori nell'interfaccia

## Stack

| Livello | Tecnologie |
| --- | --- |
| Front end | React 18, TypeScript, Vite, Recharts |
| Back end | Node.js, Express, TypeScript |
| Database | SQLite (better-sqlite3) con query SQL di aggregazione |
| Test | Vitest (query SQL e API REST), Testing Library (interfaccia React) |

## Struttura

```
.
├── client/                 # Front end React
│   └── src/
│       ├── api.ts          # Chiamate HTTP tipizzate
│       ├── useAsync.ts     # Hook per il caricamento dati (con annullamento delle richieste)
│       └── components/     # Filtri, KPI, funnel, andamento, tabella canali
└── server/                 # API REST
    ├── src/
    │   ├── db.ts           # Schema SQLite e connessione
    │   ├── seed.ts         # Generazione dei dati sintetici
    │   ├── queries.ts      # Query SQL di analisi (funnel, canali, serie storica)
    │   └── app.ts          # Rotte Express, validazione e gestione errori
    └── test/               # Test di query e API
```

I test dell'interfaccia sono in `client/src/App.test.tsx`.


### Come funziona l'analisi

Le analisi lavorano per **coorte**: si considerano i clienti la cui prima visita cade nel periodo scelto e si seguono i loro eventi lungo il funnel. Così le percentuali di conversione non cambiano a seconda di quando avviene ogni passaggio.

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

## Possibili sviluppi

- Filtro per intervallo di date personalizzato
- Esportazione dei dati in CSV
- Autenticazione e dati caricabili dall'utente
- Grafici e tabelle esportabili in immagine
