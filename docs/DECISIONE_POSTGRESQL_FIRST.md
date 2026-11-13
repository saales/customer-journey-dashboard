# Decisione architetturale: PostgreSQL come database unico

## Decisione

PostgreSQL è l'unico database applicativo del prodotto. Tutti i comandi standard di sviluppo, avvio, test e produzione utilizzano il runtime PostgreSQL. Non sono previste modalità applicative parallele.

## Motivazioni

- Necessità di isolamento multi-organizzazione e controllo centralizzato delle autorizzazioni.
- Transazioni coerenti per importazioni, modifiche ai clienti e configurazione del funnel.
- Row-Level Security, vincoli relazionali e indici tenant-scoped.
- Migrazioni versionate e verificabili.
- Un solo percorso di deploy e un solo contratto di persistenza da collaudare.

## Conseguenze

- `npm run dev` avvia server PostgreSQL e client web.
- `npm start` avvia il server PostgreSQL compilato.
- `DATABASE_URL` è obbligatoria; l'avvio fallisce se schema o ruolo non superano il preflight.
- Le migrazioni sono applicate solo con comando esplicito, mai automaticamente durante lo startup.
- Il codice, le dipendenze e i test non includono implementazioni di database alternative.

## Stato della migrazione remota

La presenza delle migrazioni nel repository e il successo della CI su un database PostgreSQL temporaneo non attestano l'avvenuta applicazione su Neon. La verifica remota richiede connessione all'istanza corretta, controllo read-only dello storico e dei checksum, ispezione di ruoli/RLS e confronto dei conteggi. Non si devono eseguire DDL o trasferimenti dati prima di backup e piano di ripristino verificati.

## Condizioni per il rilascio

Test browser end-to-end, test cross-tenant, backup/restore, monitoraggio, test di carico, staging, inviti email e procedure di recupero account devono essere completati prima di trattare dati aziendali reali.