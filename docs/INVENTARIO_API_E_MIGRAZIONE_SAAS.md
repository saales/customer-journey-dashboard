# Inventario API e matrice di migrazione SaaS

> **Stato verificato sul branch recovery/checkpoint-12-postgres.** Le tabelle seguenti descrivono il runtime storico Express/SQLite. Un runtime PostgreSQL separato è stato aggiunto nel ramo e offre già un sottoinsieme di route con autenticazione, autorizzazione e contesto tenant. Non è ancora stata raggiunta la parità funzionale e il client web non è stato collegato. L'avvio in produzione resta bloccato.

## Route attualmente presenti

| Metodo e percorso | Funzione | Accesso SaaS previsto | Stato attuale |
|---|---|---|---|
| GET /api/health | Stato API e database runtime | Pubblico, risposta minima senza dettagli interni | Implementata su SQLite |
| GET /api/meta | Date disponibili e canali | admin, editor, analyst, viewer | Nessuna autenticazione |
| GET /api/funnel-stages | Elenco fasi funnel | admin, editor, analyst, viewer | Nessuna autenticazione |
| PUT /api/funnel-stages/reorder | Riordino fasi | admin | Nessuna autenticazione |
| PUT /api/funnel-stages/:id | Modifica etichetta/stato fase | admin | Nessuna autenticazione |
| POST /api/funnel-stages | Creazione fase | admin | Nessuna autenticazione |
| GET /api/summary | KPI e riepilogo funnel | admin, editor, analyst, viewer | Nessuna autenticazione |
| GET /api/channels | Confronto canali | admin, editor, analyst, viewer | Nessuna autenticazione |
| GET /api/timeseries | Serie temporale | admin, editor, analyst, viewer | Nessuna autenticazione |
| GET /api/segments | Analisi segmenti | admin, editor, analyst, viewer | Nessuna autenticazione |
| GET /api/segments/customers | Clienti di un segmento | admin, editor, analyst, viewer | Nessuna autenticazione |
| GET /api/customers | Elenco clienti paginato | admin, editor, analyst, viewer | Nessuna autenticazione |
| POST /api/customers | Creazione cliente ed eventi | admin, editor | Nessuna autenticazione |
| PUT /api/customers/:id | Modifica cliente ed eventi | admin, editor | Nessuna autenticazione |
| DELETE /api/customers/:id | Eliminazione cliente ed eventi | admin, editor | Nessuna autenticazione |
| POST /api/import | Importazione CSV validata | admin, editor | Nessuna autenticazione |

La matrice dei ruoli è una policy target da implementare e testare lato server. Non descrive permessi già attivi.

## Requisiti trasversali per ogni route tenant-scoped

1. Il middleware di autenticazione valida il cookie di sessione, cerca l'hash del token nel database e verifica scadenza/revoca.
2. Il contesto della richiesta contiene `userId`, `organizationId` e `role`, ricavati dalla sessione e dalla membership corrente.
3. Nessun endpoint accetta `organizationId` dal body, dalla query string o da header controllabili dal client come fonte di autorizzazione.
4. Ogni query, conteggio, join, update e delete applica il filtro `organization_id`; le foreign key composite impediscono collegamenti tra tenant anche in caso di bug applicativo.
5. Il controllo del ruolo avviene dopo l'autenticazione e prima di leggere o modificare dati.
6. Le risposte per risorse inesistenti o appartenenti a un altro tenant non devono rivelare l'esistenza di dati esterni.
7. Le operazioni multi-record (creazione cliente/eventi, import, riordino fasi) sono atomiche.
8. Il logging di audit registra le mutazioni sensibili senza password, token, cookie o altri segreti.

## Route SaaS ancora da progettare

Queste route non sono presenti nel prototipo e non vanno considerate implementate:

- Sessioni: login, logout, sessioni correnti e revoca.
- Inviti: creazione, consultazione e accettazione con token monouso.
- Membri: elenco, cambio ruolo e rimozione membership.
- Organizzazione: lettura e modifica delle impostazioni tenant.
- Audit: consultazione degli eventi di audit da parte degli admin.
- Bootstrap amministratore: comando CLI una tantum, mai endpoint HTTP pubblico.
- Recupero account e verifica email: richiedono flussi e provider da definire prima dell'esposizione.

## Sequenza di implementazione e test

1. Recuperare la baseline SQL esatta già applicata e verificare il checksum; non creare una baseline sostitutiva per supposizione.
2. Realizzare repository PostgreSQL e migrazioni su un database effimero CI, mantenendo Neon fuori dai test.
3. Implementare sessioni e middleware per costruire il contesto autenticato.
4. Convertire le route sopra una per volta, introducendo repository asincroni e scope tenant esplicito.
5. Aggiungere test per ogni endpoint e ruolo, inclusi tentativi cross-tenant con ID noti.
6. Verificare transazioni, import rollback, revoca/scadenza sessioni e health check sul database runtime effettivo.

## Criterio di chiusura

Nessuna route applicativa può essere considerata pronta per dati aziendali finché non esistono test automatici che dimostrino autenticazione, autorizzazione e isolamento tenant. La sola presenza di PostgreSQL, di un pool o di una connessione riuscita non soddisfa questo criterio.


## Nuovo runtime PostgreSQL separato (stato del ramo)

Il modulo `server/src/postgres-server.ts` avvia `createPostgresApp` senza sostituire l'entrypoint SQLite predefinito. Lo startup non applica DDL: confronta in sola lettura il registro migrazioni, verifica il ruolo corrente e interrompe l'avvio in caso di migrazioni mancanti/divergenti, RLS disattivato, proprietà delle tabelle o privilegi mancanti.

| Metodo e percorso | Funzione | Permesso | Stato |
|---|---|---|---|
| POST /api/auth/login | Autenticazione e cookie di sessione | Origine esatta consentita; limite persistente tentativi | Server e modulo browser collegati |
| GET /api/auth/session | Identità e ruolo correnti | Sessione valida | Implementata |
| POST /api/auth/logout | Revoca sessione e cancellazione cookie | Sessione valida e origine consentita | Implementata |
| GET /api/customers | Elenco paginato tenant-scoped | customers:read | Implementata |
| POST /api/customers | Creazione cliente e percorso atomico | customers:write | Implementata; la fase Visita viene generata dal server |
| PUT /api/customers/:id | Modifica dati e percorso cliente atomica | customers:write | Implementata |
| DELETE /api/customers/:id | Eliminazione cliente tenant-scoped | customers:write | Implementata |
| GET /api/funnel-stages | Elenco fasi tenant-scoped | funnel:read | Implementata |
| POST /api/funnel-stages | Creazione fase personalizzata con posizione finale | funnel:write | Implementata |
| PUT /api/funnel-stages/reorder | Riordino fasi tenant-scoped con visita e cliente come estremi | funnel:write | Implementata |
| PUT /api/funnel-stages/:id | Modifica etichetta/attivazione fase | funnel:write | Implementata |

Il contesto organizzazione viene sempre letto dalla sessione PostgreSQL verificata, non da parametri forniti dal client. Le scritture sono protette da controllo Origin esatto. I cookie di produzione usano il prefisso `__Host-`, `Secure`, `HttpOnly`, `Path=/` e `SameSite=Strict`.

La migrazione `005_runtime_role_grants.sql` assegna privilegi minimi al ruolo `percorso_app`. La configurazione dei ruoli è documentata in `docs/CONFIGURAZIONE_RUOLI_POSTGRESQL.md`.

### Funzioni ancora mancanti nel runtime PostgreSQL

- API di confronto avanzato tra periodi e segmenti combinati oltre al confronto canali.
- API di importazione CSV/Excel.
- API di esportazione e audit consultabile.
- Gestione membri, inviti, recupero account e bootstrap amministratore.
- Collegamento del client React e test end-to-end dell'intero percorso utente.
- Verifica su un ambiente di staging isolato e collaudo di backup/ripristino.

Le route del runtime SQLite nella prima tabella non sono automaticamente protette dalle nuove middleware: il server PostgreSQL è un processo distinto e il runtime SQLite continua a non essere adatto a dati aziendali reali.


## Accesso dal browser

Il client ora verifica `GET /api/auth/session` prima di montare la dashboard, presenta il modulo di accesso e invia email, password e codice organizzazione a `POST /api/auth/login`. La sessione resta in un cookie HttpOnly e non viene copiata in localStorage o JavaScript. L'uscita chiama `POST /api/auth/logout`.

In sviluppo, se il runtime non espone la route di sessione (404), il client mantiene una modalità demo esclusivamente locale per il server SQLite storico. In produzione non esiste questo ripiego: se il runtime PostgreSQL non è disponibile o l'accesso non è configurato, la dashboard resta chiusa.
