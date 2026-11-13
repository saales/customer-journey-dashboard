# Architettura e scelte progettuali

## 1. Obiettivo

Il progetto nasce per rispondere a due domande tipiche dell'analisi del percorso di acquisto:

1. **Dove si perdono i clienti** lungo il funnel (visita → contatto → qualificato → opportunità → cliente)?
2. **Quali canali di acquisizione** (Organico, Social, Email, Pubblicità e Passaparola) generano le migliori conversioni?

L'obiettivo è organizzare i dati relativi alle diverse fasi del customer journey e renderli consultabili attraverso indicatori, grafici e strumenti di analisi.

## 2. Modello dati

Il database SQLite, definito in `server/src/db.ts`, utilizza due tabelle principali:

| Tabella | Contenuto |
|---|---|
| `customers` | Un record per persona, con canale di provenienza e data della prima visita |
| `events` | Un record per ogni fase raggiunta (`visit`, `lead`, `qualified`, `opportunity`, `customer`), con la relativa data |

Ogni cliente ha sempre un evento `visit`. Gli altri eventi vengono registrati soltanto quando il cliente raggiunge la relativa fase del percorso.

Questa struttura separa le informazioni anagrafiche del cliente dagli eventi che descrivono la sua evoluzione nel funnel.

## 3. Analisi per coorte

Le analisi partono da una **coorte**, composta dai clienti la cui prima visita ricade nel periodo selezionato.

Una volta individuati questi clienti, vengono considerati i relativi eventi lungo il percorso, anche quando si verificano dopo la fine del periodo selezionato.

Questa scelta evita di confrontare eventi appartenenti a gruppi di clienti differenti. Ad esempio, un cliente acquisito a gennaio che diventa cliente effettivo a marzo continua a essere associato alla coorte di gennaio.

In questo modo, il denominatore (le visite iniziali) e il numeratore (i clienti convertiti) si riferiscono alle stesse persone, rendendo più coerente il calcolo delle percentuali di conversione.

## 4. Query SQL e aggregazioni

Le principali interrogazioni sono definite in `server/src/queries.ts`.

- **Funnel:** utilizza `COUNT(DISTINCT customer_id)` raggruppato per fase, con una `JOIN` tra `events` e `customers` e un filtro sulla data della prima visita. Quando richiesto, viene applicato anche il filtro sul canale. Le percentuali di conversione vengono calcolate in TypeScript a partire dai conteggi.
- **Confronto tra canali:** utilizza una singola query con `COUNT(DISTINCT CASE WHEN stage = '...' THEN id END)` per contare visite, contatti e clienti per canale, evitando di eseguire tre query separate.
- **Andamento mensile:** raggruppa i clienti in base al mese della prima visita, utilizzando substr(created_at, 1, 7). Per ogni coorte mensile vengono confrontati i clienti entrati nel funnel e quelli che hanno successivamente raggiunto la fase di acquisto.
- **Tempo medio all'acquisto:** utilizza una `JOIN` della tabella `events` con se stessa, mettendo in relazione l'evento `visit` e l'evento `customer` dello stesso cliente. La media viene calcolata con `AVG(julianday(...) - julianday(...))`.

Le query utilizzano **parametri nominati** (`@from`, `@to`, `@channel`), evitando di concatenare direttamente i valori ricevuti dall'utente nel testo SQL.

Le aggregazioni vengono eseguite direttamente nel database, in modo da trasferire al server risultati già sintetizzati anziché tutti i singoli eventi.

## 5. API e backend

Il backend è realizzato con Node.js, Express e TypeScript. Le rotte sono definite in `server/src/app.ts`.

Le API REST consentono sia la consultazione dei dati sia la gestione dei clienti.

| Metodo | Endpoint | Funzione |
|---|---|---|
| GET | `/api/health` | Verifica lo stato del server |
| GET | `/api/meta` | Recupera l'intervallo temporale disponibile e i canali |
| GET | `/api/summary` | Recupera KPI e dati del funnel |
| GET | `/api/channels` | Recupera il confronto tra canali |
| GET | `/api/timeseries` | Recupera l'andamento mensile |
| GET | `/api/customers` | Recupera l'elenco dei clienti |
| POST | `/api/customers` | Inserisce un nuovo cliente |
| PUT | `/api/customers/:id` | Modifica un cliente esistente |
| DELETE | `/api/customers/:id` | Elimina un cliente |

Le principali caratteristiche del backend sono:

- **Validazione dei parametri:** le date utilizzano il formato `YYYY-MM-DD`; viene verificato che la data iniziale non sia successiva a quella finale e che il canale appartenga a quelli ammessi.
- **Gestione degli errori:** gli errori previsti restituiscono risposte HTTP `4xx`, mentre quelli inattesi vengono gestiti con una risposta `500` generica. I dettagli degli errori vengono mantenuti nei log.
- **Header di sicurezza:** sono presenti header di sicurezza di base e l'header `x-powered-by` è disattivato.
- **Gestione delle rotte inesistenti:** le richieste a endpoint `/api` non disponibili restituiscono una risposta JSON con stato `404`.

## 6. Frontend e interfaccia

Il frontend è sviluppato con React e TypeScript, utilizzando componenti separati per organizzare le diverse funzionalità.

La struttura comprende:

- **Panoramica:** visualizzazione dei KPI principali e delle informazioni sintetiche sul percorso di conversione.
- **Analisi e report:** filtri, funnel, andamento mensile e confronto tra canali.
- **Gestione clienti:** consultazione, inserimento, modifica ed eliminazione dei clienti.
- **Impostazioni:** gestione delle preferenze dell'interfaccia, tra cui tema chiaro/scuro e navigazione laterale.

Alcune scelte tecniche rilevanti:

- **`useAsync`:** hook personalizzato che gestisce le chiamate API e annulla quella precedente tramite `AbortController` quando cambiano i filtri, evitando che una risposta più lenta sovrascriva dati aggiornati.
- **`useMemo`:** utilizzato per costruire l'oggetto della query, evitando ricaricamenti non necessari quando i filtri non cambiano.
- **Gestione degli stati:** caricamento, errore, assenza di dati e intervallo temporale non valido sono rappresentati in modo esplicito.
- **Esportazione CSV:** i file sono predisposti per Excel in italiano, con separatore `;`, virgola decimale e BOM UTF-8.

## 7. Test e qualità

Il progetto include test automatici per verificare il comportamento delle principali componenti.

- **Query SQL:** eseguite su un database in memoria con un insieme limitato di dati noti, per confrontare i risultati ottenuti con quelli attesi.
- **API:** verificano le risposte corrette, gli errori `400` e `404`, i periodi senza dati e gli header.
- **Interfaccia:** utilizzano Testing Library e chiamate `fetch` simulate per verificare KPI, filtri, intervalli personalizzati, errori e stati vuoti.
- **Continuous Integration:** GitHub Actions esegue automaticamente test e build su Node.js 20 e 22 a ogni push.

## 8. Limiti e scelte consapevoli

- **Dati sintetici:** i dati utilizzati sono dimostrativi e le probabilità di conversione sono ipotetiche. Il progetto dimostra un metodo di analisi, non rappresenta risultati aziendali reali.
- **SQLite:** è una soluzione adeguata per una demo e per un'applicazione utilizzata da un singolo processo. In uno scenario con più utenti e scritture concorrenti sarebbe opportuno valutare PostgreSQL.
- **Autenticazione:** non è prevista una gestione degli utenti e dei relativi permessi. In un'applicazione aziendale reale sarebbe necessario introdurre autenticazione e autorizzazioni.
- **Sequenza del funnel:** il modello assume che le fasi vengano raggiunte in ordine e non gestisce percorsi in cui un cliente salta una o più fasi.

## 9. Possibili evoluzioni

- Importazione di dati aziendali tramite file CSV.
- Confronto tra due periodi temporali.
- Analisi più approfondita dei tassi di abbandono nelle singole fasi.
- Introduzione di autenticazione e autorizzazioni.
- Migrazione del database a PostgreSQL.
- Test end-to-end con Playwright per verificare i principali flussi di utilizzo.