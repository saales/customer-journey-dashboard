# Architettura della piattaforma

## Obiettivo

Percorso Cliente è una piattaforma B2B per analizzare le coorti di acquisizione, l'avanzamento nel funnel e la conversione, con dati separati per organizzazione.

## Architettura applicativa

- **Interfaccia:** React, TypeScript e Vite; tutte le richieste applicative passano dalle API same-origin.
- **Server:** Node.js, Express e TypeScript, avviato da `server/src/postgres-server.ts`.
- **Persistenza:** PostgreSQL tramite `pg`; non sono presenti runtime o dipendenze alternative.
- **Identità:** sessioni opache memorizzate come hash, cookie HttpOnly e membership organizzativa attiva.
- **Autorizzazione:** middleware lato server per ruolo e permesso; i controlli dell'interfaccia sono soltanto un livello di presentazione.
- **Isolamento:** ogni repository riceve l'organizzazione dalla sessione autenticata e applica filtri espliciti; le tabelle tenant-scoped applicano inoltre RLS.
- **Migrazioni:** file SQL versionati, checksum, advisory lock e preflight; lo startup verifica lo schema ma non applica DDL.

## Flussi principali

1. L'utente accede con slug organizzazione, email e password.
2. Il server verifica credenziali e membership, crea una sessione e restituisce il cookie protetto.
3. Ogni richiesta protetta risolve la sessione dal database; l'identificativo organizzazione non viene accettato dal browser come autorità.
4. I repository eseguono letture e scritture tenant-scoped dentro transazioni PostgreSQL.
5. Le operazioni amministrative e di importazione registrano gli eventi di audit previsti.

## API

| Area | Endpoint principali |
|---|---|
| Accesso | `/api/auth/login`, `/api/auth/session`, `/api/auth/logout` |
| Analisi | `/api/meta`, `/api/summary`, `/api/channels`, `/api/timeseries` |
| Clienti | `/api/customers` e `/api/customers/:id` |
| Funnel | `/api/funnel-stages` e `/api/funnel-stages/:id` |
| Importazione | `/api/import` |
| Segmentazione | `/api/segments`, `/api/segments/customers` |
| Esportazione | `/api/export/customers.csv` |
| Membri | `/api/members`, `/api/members/:id` |

## Analisi

Le analisi sono basate sulla coorte: la popolazione è determinata dalla data della prima visita e gli eventi successivi vengono attribuiti alla stessa coorte. I conteggi sono distinti per cliente; i tassi sono calcolati sui denominatori dichiarati dal contratto analitico.

## Qualità e limiti

La CI usa PostgreSQL temporaneo e verifica test e build su Node.js 20 e 22. Questo non dimostra che lo schema del database remoto sia già migrato, né sostituisce test browser end-to-end, backup/restore, test di carico e collaudo in staging. Il bootstrap iniziale non è un flusso di invito; l'invio email e il recupero account non sono ancora disponibili.

## Configurazione e avvio

Il runtime standard richiede `DATABASE_URL`, `APP_ORIGIN` e `LOGIN_RATE_LIMIT_SECRET`. Le migrazioni vanno eseguite esplicitamente con `npm run db:migrate`; lo startup si interrompe se lo storico è incompleto o divergente.