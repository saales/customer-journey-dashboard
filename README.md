# Analisi del percorso cliente

Applicazione web per osservare e comprendere il percorso che conduce una persona dal primo contatto alla conversione. Riunisce indicatori, andamento nel tempo, confronto dei canali, segmentazione e gestione delle anagrafiche in un'unica interfaccia.

L'obiettivo del prodotto è aiutare organizzazioni e gruppi di lavoro a individuare i passaggi più efficaci, riconoscere i punti di abbandono e prendere decisioni basate sui dati.

> **Stato del progetto:** è in corso la migrazione dal runtime SQLite a un servizio multi-organizzazione PostgreSQL. Nel ramo di sviluppo è ora presente un server HTTP PostgreSQL separato con accesso, sessioni, API iniziali clienti/funnel e controlli di sicurezza all'avvio. Il client web e le API di analisi, importazione ed esportazione non sono ancora migrati; il runtime predefinito resta SQLite e l'avvio in produzione resta bloccato. Il prodotto non è ancora idoneo a trattare dati aziendali reali né a essere venduto come servizio pronto all'uso.

[![Verifiche automatiche](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/saales/customer-journey-dashboard/actions/workflows/ci.yml)

## Funzionalità disponibili nell'applicazione attuale

- **Indicatori principali:** visite iniziali, contatti, clienti, tasso di conversione e tempo medio alla conversione.
- **Percorso di conversione:** analisi delle fasi Visita, Contatto, Qualificazione, Opportunità e Cliente.
- **Andamento nel tempo:** evoluzione delle visite e del tasso di conversione.
- **Confronto dei canali:** analisi delle prestazioni dei diversi canali di acquisizione.
- **Filtri temporali:** selezione di intervalli predefiniti o personalizzati e dei canali.
- **Gestione clienti:** inserimento, modifica, eliminazione e consultazione paginata.
- **Importazione:** caricamento e verifica preliminare di file CSV o Excel.
- **Segmentazione e confronti:** lettura dei risultati per gruppi, periodi e canali.
- **Esportazione:** produzione di file CSV, Excel e PDF.
- **Preferenze di visualizzazione:** tema chiaro o scuro e interfaccia adattabile alle dimensioni dello schermo.

Le funzioni sono in fase di consolidamento e non devono essere interpretate come prova del completamento dell'architettura multi-organizzazione.

## Tecnologie

| Ambito | Tecnologie |
|---|---|
| Interfaccia web | React, TypeScript, Vite, Recharts |
| Server applicativo | Node.js, Express, TypeScript |
| Database attuale | SQLite |
| Database di destinazione | PostgreSQL |
| Verifiche | Vitest, Testing Library, PostgreSQL temporaneo |
| Automazione delle verifiche | GitHub Actions, Node.js 20 e 22 |

## Struttura del progetto

```text
.
├── client/
│   └── src/
│       ├── components/       # Componenti dell'interfaccia
│       ├── api.ts            # Comunicazione con il server
│       ├── format.ts         # Formattazione e periodi
│       └── styles.css        # Stili dell'interfaccia
├── server/
│   ├── migrations/           # Migrazioni PostgreSQL versionate
│   ├── src/                  # Server e moduli applicativi
│   └── test/                 # Verifiche automatiche
├── docs/                     # Architettura, decisioni e piani
├── package.json
├── README.md
└── LICENSE
```

## Criteri di analisi

Le analisi sono organizzate per coorte: si considerano i clienti la cui prima visita ricade nell'intervallo selezionato e si osservano gli eventi successivi lungo il percorso di conversione.

Questo criterio consente di confrontare periodi e canali mantenendo costante la base di osservazione. Le definizioni degli indicatori e le relative query sono documentate nei materiali tecnici del progetto.

## Interfacce applicative

Le API operative del runtime predefinito sono ancora quelle SQLite. In parallelo, il ramo include un runtime PostgreSQL separato (`server/src/postgres-server.ts`) con rotte di autenticazione, clienti e fasi funnel. Questo runtime non sostituisce ancora SQLite e non offre tutta la parità funzionale: il client web, le analisi, l'importazione e le esportazioni devono ancora essere collegati e collaudati.

## Avvio in ambiente locale

### Requisiti

- Node.js 20 o versione successiva
- npm

### Installazione e avvio

Dalla cartella principale:

```bash
npm install
npm run dev
```

L'interfaccia è disponibile all'indirizzo:

[http://localhost:5173](http://localhost:5173)

Il server locale è disponibile all'indirizzo:

[http://localhost:3001](http://localhost:3001)

Al primo avvio viene creato il database SQLite locale, inizialmente vuoto. Per caricare dati dimostrativi occorre abilitarli esplicitamente in un ambiente non di produzione:

```bash
ALLOW_DEMO_SEED=true npm run seed
```

Il caricamento dimostrativo è bloccato in produzione. Utilizzare esclusivamente dati sintetici e un ambiente locale separato da qualsiasi archivio aziendale.

## Verifiche automatiche

Per eseguire le verifiche dei moduli:

```bash
npm test
```

Per compilare l'applicazione:

```bash
npm run build
```

Le verifiche automatiche del ramo di sviluppo vengono eseguite su Node.js 20 e 22. I test PostgreSQL utilizzano un servizio temporaneo predisposto per la durata dell'esecuzione: non operano sul database Neon.

## Architettura e sicurezza

Il percorso di evoluzione prevede PostgreSQL come unico database di destinazione, con separazione dei dati per organizzazione, ruoli, sessioni, registri di controllo e verifiche d'integrità.

Nel ramo di sviluppo sono presenti migrazioni versionate, autenticazione PostgreSQL, cookie di sessione, middleware per i ruoli, API tenant-scoped iniziali, limiti persistenti ai tentativi di accesso e un preflight che rifiuta ruoli PostgreSQL non sicuri. Il server PostgreSQL si avvia solo se lo storico migrazioni è completo e coerente e se il ruolo runtime è separato dal proprietario, non privilegiato e dotato dei permessi minimi.

Il runtime predefinito continua a utilizzare SQLite e il client non è ancora collegato alle nuove API PostgreSQL. L'avvio in produzione rimane quindi bloccato fino al completamento e alla verifica di:
- migrazione completa del client e delle API di analisi, importazione ed esportazione;
- test end-to-end di login, logout, permessi e isolamento tra organizzazioni;
- verifiche operative di backup, ripristino e osservabilità;
- migrazione di tutte le funzioni applicative a PostgreSQL;
- prove di aggiornamento, backup e ripristino;
- collaudo in un ambiente separato.

Nessuna migrazione di questo ramo è stata applicata al database Neon. Prima di qualsiasi trasferimento occorre verificarne lo storico e accertare la presenza di eventuali dati reali.

## Documentazione

La cartella `docs/` contiene:
- descrizione dell'architettura e delle scelte progettuali;
- inventario delle API e piano di evoluzione;
- decisione architetturale relativa a PostgreSQL;
- contratto dei dati e regole di isolamento;
- piano delle migrazioni e registro delle evidenze;
- criteri di prodotto, collaudo e rilascio.

## Licenza

Licenza MIT. Consultare il file [LICENSE](LICENSE).
