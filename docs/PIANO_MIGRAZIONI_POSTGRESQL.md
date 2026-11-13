# Piano operativo PostgreSQL e verifica dati

## Obiettivo

Assicurare che il database effettivamente usato dal prodotto sia PostgreSQL, che il relativo schema sia coerente con le migrazioni versionate e che nessun dato venga perso o duplicato durante il cutover.

## Stato codice

- Il runtime standard usa il server PostgreSQL.
- Le migrazioni versionate 001–007 sono presenti nel repository.
- Il runner verifica ordine, checksum e advisory lock.
- Lo startup esegue controlli read-only e si interrompe in caso di migrazioni pendenti o drift.
- I test d'integrazione usano PostgreSQL temporaneo nella CI.

## Verifiche richieste sul database effettivo

1. Identificare in modo indipendente l'istanza e il database di destinazione.
2. Eseguire `npm run db:migrate -- --check` con credenziali di sola lettura/controllo appropriate e registrare database, ruolo, timestamp, migrazioni applicate, pendenti e drift.
3. Eseguire l'ispezione read-only di tabelle, vincoli, indici, RLS, proprietari e privilegi.
4. Verificare il backup recente e completare una prova di ripristino su un'istanza isolata.
5. Confrontare conteggi e integrità dei record tra la sorgente disponibile e il database di destinazione.
6. Se esistono dati da trasferire, predisporre una procedura idempotente, con mapping, deduplicazione, audit e report degli scarti.
7. Solo dopo approvazione del piano e backup verificato, applicare le migrazioni pendenti.
8. Eseguire bootstrap soltanto se il database è realmente vuoto; non usare il bootstrap per sovrascrivere o ricreare un tenant esistente.

## Regole di sicurezza

- Non eseguire migrazioni automatiche all'avvio.
- Non usare il ruolo applicativo per DDL o bootstrap.
- Non eseguire seed sintetici su ambienti aziendali.
- Non assumere che un nome progetto o una variabile `DATABASE_URL` identifichi il database corretto: verificare sempre database e ruolo.
- Non cancellare o ricreare tabelle per risolvere un drift.
- In caso di checksum divergente, fermarsi e ricostruire la provenienza della migrazione.

## Criteri di accettazione

- Storico migrazioni remoto coerente con i file del repository.
- Nessuna migrazione pendente o divergenza non spiegata.
- Ruolo runtime non proprietario, non superuser e senza `BYPASSRLS`.
- RLS e vincoli verificati sulle tabelle tenant-scoped.
- Conteggi e campioni dati riconciliati.
- Backup e restore dimostrati.
- Test HTTP/browser end-to-end e isolamento cross-tenant superati.
- Staging validato prima di qualunque rilascio.