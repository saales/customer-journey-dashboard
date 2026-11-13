# Decisione architetturale: PostgreSQL come database unico

## Decisione

PostgreSQL è l'unico database applicativo. Tutti i comandi standard di sviluppo, avvio, test e produzione utilizzano il runtime PostgreSQL.

## Motivazioni

- Isolamento multi-organizzazione e autorizzazioni centralizzate.
- Transazioni coerenti per importazioni, modifiche clienti e funnel.
- Row-Level Security, vincoli relazionali e indici tenant-scoped.
- Migrazioni versionate e verificabili.
- Un solo percorso di deploy e un solo contratto di persistenza.

## Conseguenze

- `npm run dev` avvia server PostgreSQL e client web.
- `npm start` avvia il server PostgreSQL compilato.
- `DATABASE_URL` è obbligatoria.
- L'avvio fallisce se lo schema non corrisponde allo storico migrazioni o il ruolo non supera il preflight.
- Le migrazioni sono applicate solo con comando esplicito.

## Stato remoto

La presenza delle migrazioni nel repository e il successo della CI su PostgreSQL temporaneo non attestano l'avvenuta applicazione su Neon. La verifica remota richiede preflight read-only, controllo ruoli/RLS/checksum, backup e confronto dei conteggi. Nessuna scrittura o DDL remoto è stata eseguita in questa attività.

## Condizioni di rilascio

Test browser end-to-end, test cross-tenant, backup/restore, monitoraggio, test di carico e staging devono essere completati prima di trattare dati aziendali reali.