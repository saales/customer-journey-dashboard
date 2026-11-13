# Inventario API e matrice di migrazione SaaS

> **Stato verificato sul branch recovery/checkpoint-12-postgres.** Questo inventario descrive le route presenti nel prototipo Express/SQLite e il controllo di accesso richiesto per la futura versione SaaS. Non implementa autenticazione o autorizzazioni: oggi le route applicative elencate non hanno un contesto utente/tenant autenticato. L'avvio in produzione resta quindi bloccato.

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
