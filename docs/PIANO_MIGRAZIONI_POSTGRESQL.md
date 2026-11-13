# Piano operativo PostgreSQL e verifica dati

## Obiettivo

Assicurare che il database effettivamente usato dal prodotto sia PostgreSQL, che lo schema corrisponda alle migrazioni versionate e che nessun dato venga perso o duplicato durante il cutover.

## Stato codice

- Runtime standard PostgreSQL.
- Migrazioni versionate 001–010.
- Runner con checksum, ordine e advisory lock.
- Startup read-only che si interrompe in caso di migrazioni pendenti o drift.
- CI con PostgreSQL temporaneo, applicazione migrazioni e avvio con ruolo limitato; test browser Playwright rappresentativo su Node.js 22.

## Verifiche sul database effettivo

1. Identificare istanza e database di destinazione.
2. Eseguire `npm run db:migrate -- --check` e registrare database, ruolo, timestamp, migrazioni applicate, pendenti e drift.
3. Ispezionare tabelle, vincoli, indici, RLS, proprietari e privilegi.
4. Verificare backup recente e completare una prova di ripristino su istanza isolata.
5. Confrontare conteggi e integrità dei record tra sorgente disponibile e destinazione.
6. Se esistono dati da trasferire, predisporre procedura idempotente con mapping, deduplicazione, audit e report scarti.
7. Solo dopo approvazione e backup verificato, applicare eventuali migrazioni pendenti.
8. Eseguire bootstrap solo se il database è realmente vuoto.

## Regole

- Non applicare migrazioni automaticamente all'avvio.
- Non usare il ruolo applicativo per DDL o bootstrap.
- Non eseguire seed sintetici su ambienti aziendali.
- Verificare sempre database e ruolo effettivi.
- Non cancellare o ricreare tabelle per risolvere drift.
- In caso di checksum divergente, fermarsi e ricostruire la provenienza.

## Criteri di accettazione

- Storico migrazioni remoto coerente con i file del repository.
- Nessuna migrazione pendente o divergenza non spiegata.
- Ruolo runtime non proprietario, non superuser e senza `BYPASSRLS`.
- RLS e vincoli verificati sulle tabelle tenant-scoped.
- Conteggi e campioni dati riconciliati.
- Backup e restore dimostrati.
- Test HTTP/browser end-to-end rappresentativo e test di isolamento cross-tenant superati; completare la matrice browser dei quattro ruoli prima del pilot.
- Staging validato prima del rilascio.