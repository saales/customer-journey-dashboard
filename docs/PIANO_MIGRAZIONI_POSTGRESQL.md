# Piano operativo PostgreSQL e verifica dati

## Obiettivo

Assicurare che il database effettivamente usato dal prodotto sia PostgreSQL, che lo schema corrisponda alle migrazioni versionate e che nessun dato venga perso o duplicato durante il cutover.

## Stato codice

- Runtime standard PostgreSQL.
- Migrazioni versionate 001–013.
- Runner con checksum, ordine e advisory lock.
- Migrazione 010: grant SELECT su `audit_logs` al ruolo runtime, mantenendo RLS tenant-scoped.
- Migrazione 011: token di recupero password e grant strettamente limitati.
- Migrazione 012: grant UPDATE limitato al nome organizzazione.
- Migrazione 013: grant UPDATE limitato al profilo utente; il cambio password revoca tutte le sessioni.
- Startup read-only che si interrompe in caso di migrazioni pendenti o drift.
- Verificatore read-only disponibile con `npm run db:verify-readonly -w server -- --expect-database <nome>`; in staging/produzione TLS è obbligatorio.
- CI con PostgreSQL temporaneo, applicazione migrazioni, controllo RLS e avvio con ruolo limitato; Playwright su Node.js 22.

## Verifiche sul database effettivo

1. Identificare istanza, host e database di destinazione.
2. Eseguire `npm run db:migrate -- --check` e registrare database, ruolo, timestamp, migrazioni applicate, pendenti e drift.
3. Eseguire il verificatore read-only con il ruolo runtime e il nome database atteso.
4. Ispezionare tabelle, vincoli, indici, RLS, proprietari e privilegi.
5. Verificare backup recente e completare una prova di ripristino su istanza isolata.
6. Confrontare conteggi e integrità dei record tra sorgente disponibile e destinazione.
7. Se esistono dati da trasferire, predisporre procedura idempotente con mapping, deduplicazione, audit e report scarti.
8. Solo dopo approvazione e backup verificato, applicare eventuali migrazioni pendenti.
9. Eseguire bootstrap solo se il database è realmente vuoto.

## Regole

- Non applicare migrazioni automaticamente all'avvio.
- Non usare il ruolo applicativo per DDL o bootstrap.
- Non eseguire seed sintetici su ambienti aziendali.
- Verificare sempre host, database e ruolo effettivi.
- Non cancellare o ricreare tabelle per risolvere drift.
- In caso di checksum divergente, fermarsi e ricostruire la provenienza.
- Non eseguire cancellazioni tenant manuali in staging/produzione: nel ramo non esiste un comando dedicato con guardrail certificati.

## Criteri di accettazione

- Storico migrazioni remoto coerente con i file del repository.
- Nessuna migrazione pendente o divergenza non spiegata.
- Ruolo runtime non proprietario, non superuser e senza `BYPASSRLS`.
- RLS e vincoli verificati sulle tabelle tenant-scoped.
- Conteggi e campioni dati riconciliati.
- Backup e restore dimostrati.
- Test HTTP/browser end-to-end rappresentativo e matrice autorizzazioni superati; completare i casi cross-tenant per tutte le API prima del pilot.
- Staging validato prima del rilascio.
