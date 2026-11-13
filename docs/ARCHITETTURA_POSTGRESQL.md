# Architettura PostgreSQL — runtime unico

## Runtime

Il server HTTP standard avvia `server/src/postgres-server.ts` e usa il pool condiviso `server/src/postgres.ts`. I comandi standard di sviluppo, avvio, test e produzione usano PostgreSQL. Non sono previste modalità applicative parallele.

## Moduli

- Autenticazione, password scrypt, sessioni opache, risoluzione e revoca.
- Middleware di sessione, ruoli e permessi.
- API tenant-scoped per clienti, eventi, funnel, analisi, segmentazione e importazione.
- Gestione membri e inviti monouso con scadenza, revoca e accettazione atomica.
- Audit log per import, membership, inviti, clienti e modifiche funnel.
- Esportazione CSV clienti lato server con permesso dedicato, limite massimo e mitigazione formula injection.
- Migrazioni versionate 001–008, checksum, advisory lock e preflight read-only.
- Verifica del ruolo runtime e dei privilegi minimi.

## Avvio sicuro

Il server non applica migrazioni automaticamente. Verifica lo storico e il ruolo PostgreSQL; se esistono migrazioni pendenti, checksum divergenti o privilegi non conformi, il processo non apre la porta HTTP.

## Stato del database remoto

Il repository e la CI dimostrano che il codice e le migrazioni funzionano su PostgreSQL temporaneo. Non dimostrano che Neon contenga già le migrazioni 001–008 o che i dati precedenti siano stati trasferiti. Serve un preflight read-only sull'istanza effettiva, confronto checksum/ruoli/RLS e riconciliazione dei conteggi. Nessuna operazione remota è stata eseguita da questa attività.

## Limiti di rilascio

Non dichiarare il prodotto pronto per dati reali o vendita finché non sono completati test browser end-to-end, backup/restore, test di carico, osservabilità e staging. L'invio email automatico e il recupero password/account restano da implementare.