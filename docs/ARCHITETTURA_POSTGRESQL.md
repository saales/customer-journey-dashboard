# Architettura PostgreSQL — stato implementato

## Runtime unico

Il server HTTP standard avvia `server/src/postgres-server.ts` e usa il pool PostgreSQL condiviso in `server/src/postgres.ts`. I comandi `dev`, `start`, `build` e `test` sono configurati sul runtime PostgreSQL. Le implementazioni precedenti e le relative dipendenze sono state rimosse dal ramo.

## Moduli presenti

- Autenticazione, verifica password scrypt, sessioni opache, risoluzione sessione e revoca.
- Middleware di autenticazione, ruoli e permessi.
- API tenant-scoped per clienti, eventi, funnel, analisi, segmentazione e importazione.
- Gestione membri con protezione dell'ultimo amministratore attivo e audit log.
- Esportazione clienti CSV lato server con permesso dedicato, limite massimo e mitigazione formula injection.
- Migrazioni versionate 001–007, controllo checksum, advisory lock e preflight read-only.
- Verifica del ruolo PostgreSQL runtime e dei privilegi minimi.

## Avvio sicuro

Il server non applica migrazioni automaticamente. Carica la configurazione locale, controlla lo storico delle migrazioni e verifica il ruolo runtime. Se esistono migrazioni pendenti, checksum divergenti o privilegi non conformi, il processo non apre la porta HTTP.

## Stato del database remoto

Il repository e la CI dimostrano che il codice e le migrazioni possono essere eseguiti su PostgreSQL temporaneo. Non dimostrano che Neon contenga già le migrazioni 001–007, che i checksum remoti coincidano o che i dati precedenti siano stati trasferiti. Per questo serve un preflight read-only eseguito sull'istanza effettiva e una verifica documentata dei conteggi; nessuna operazione remota viene effettuata da questa attività.

## Stato di rilascio

Non dichiarare il prodotto pronto per dati reali o vendita finché non sono conclusi test browser end-to-end, prove di backup e ripristino, test di carico, verifiche di osservabilità e staging. Il flusso di invito e consegna email non è implementato.