# Architettura e scelte progettuali

## Obiettivo

Rispondere a due domande tipiche di chi analizza il percorso d'acquisto:

1. **Dove si perdono i clienti** lungo il funnel (visita → lead → qualificato → opportunità → cliente)?
2. **Quali canali** (organico, social, email, advertising, referral) convertono meglio?

## Modello dati

Due tabelle SQLite (`server/src/db.ts`):

| Tabella | Contenuto |
| --- | --- |
| `customers` | un record per persona: canale di provenienza e data della prima visita |
| `events` | un record per ogni stadio raggiunto (`visit`, `lead`, `qualified`, `opportunity`, `customer`) con la data |

Ogni cliente ha sempre l'evento `visit`; gli altri stadi compaiono solo se li ha raggiunti. Il funnel è quindi un semplice conteggio di clienti distinti per stadio.

## Analisi per coorte

Tutte le analisi partono da una **coorte**: i clienti la cui prima visita cade nel periodo scelto. Poi si seguono i loro eventi, anche se avvengono dopo la fine del periodo.

Perché: se si contassero gli eventi avvenuti nel periodo, un lead di gennaio che diventa cliente a marzo verrebbe contato nel mese sbagliato e le percentuali non sarebbero confrontabili. Con la coorte il denominatore (le visite) e il numeratore (i clienti) riguardano le stesse persone.

## Le query SQL (`server/src/queries.ts`)

- **Funnel:** `COUNT(DISTINCT customer_id)` raggruppato per stadio, con `JOIN` tra `events` e `customers` e filtro sulla data di prima visita (e, se richiesto, sul canale). Le conversioni sono calcolate in TypeScript sui conteggi.
- **Confronto tra canali:** una sola query con `COUNT(DISTINCT CASE WHEN stage = '...' THEN id END)` per contare visite, lead e clienti per canale, invece di tre query separate.
- **Andamento mensile:** raggruppamento per `substr(created_at, 1, 7)` (anno-mese).
- **Tempo medio all'acquisto:** `JOIN` della tabella `events` con se stessa (evento `visit` ed evento `customer` dello stesso cliente) e `AVG(julianday(...) - julianday(...))`.

Le query usano **parametri nominati** (`@from`, `@to`, `@channel`): nessun valore dell'utente viene concatenato nel testo SQL.

L'aggregazione è fatta nel database e non in JavaScript, per trasferire al server solo poche righe riassuntive.

## API (`server/src/app.ts`)

- Rotte REST in sola lettura (`GET`).
- Validazione dei parametri: date nel formato `YYYY-MM-DD`, `from` non successivo a `to`, canale tra quelli ammessi. Gli errori restituiscono `400` con un messaggio leggibile.
- Gestione centralizzata degli errori: gli errori attesi diventano risposte `4xx`, quelli inattesi un `500` generico (il dettaglio resta nei log).
- Header di sicurezza di base e `x-powered-by` disattivato.
- Risposta `404` in JSON per le rotte `/api` inesistenti.

## Front end (`client/src`)

- **React + TypeScript** con componenti piccoli e separati (filtri, KPI, funnel, andamento, tabella).
- **`useAsync`**: hook che esegue la chiamata e **annulla** quella precedente (`AbortController`) quando cambiano i filtri, per evitare che una risposta lenta sovrascriva una più recente.
- **`useMemo`** per costruire l'oggetto della query: i dati vengono ricaricati solo quando cambia davvero un filtro.
- Stati gestiti in modo esplicito: caricamento, errore, nessun dato, intervallo di date non valido.
- Esportazione **CSV** compatibile con Excel in italiano (separatore `;`, virgola decimale, BOM UTF-8).

## Test

- **Query SQL:** su un database in memoria con pochi dati noti, così i risultati attesi si calcolano a mano.
- **API:** server avviato su una porta casuale; si verificano risposte corrette, errori `400`, `404`, periodo senza dati e header.
- **Interfaccia:** Testing Library con `fetch` simulato; si verificano KPI, filtri, intervallo personalizzato, errori e stato vuoto.
- **CI:** a ogni push GitHub Actions esegue test e build su Node 20 e 22.

## Limiti e scelte consapevoli

- I dati sono **sintetici** e le probabilità di conversione sono inventate: il progetto dimostra il metodo di analisi, non risultati reali.
- **SQLite** va bene per una demo e per un solo processo. Con più utenti o scritture concorrenti passerei a PostgreSQL.
- Nessuna **autenticazione**: i dati non sono riservati. In un caso reale servirebbero login e autorizzazioni.
- Il funnel assume che gli stadi siano raggiunti in ordine; non gestisce clienti che saltano uno stadio.

## Possibili evoluzioni

- Dati caricabili dall'utente (importazione CSV) al posto di quelli sintetici
- Confronto tra due periodi
- Autenticazione e PostgreSQL
- Test end-to-end con Playwright
