# Verifica archivio ZIP — snapshot 16 novembre 2026

## Identificazione

- Archivio esaminato: customer-journey-dashboard-completo(5).zip
- SHA-256: fa0063aaa10a0d6fd242002ca69bdc38c03b8485369e64be2ea12facd51bd1aa
- Dimensione compressa: 3.951.404 byte
- File: 207 (224 voci ZIP includendo le directory)
- Dimensione non compressa: 5.041.313 byte
- I file del progetto sono direttamente nella radice dell'archivio.
- Non contiene una directory .git.

## Contenuto rilevato

- Applicazione web con workspace Node.js server e client.
- PostgreSQL indicato come database applicativo.
- 13 migrazioni PostgreSQL, numerate da 001 a 013.
- Documentazione, test, workflow CI e script di staging.
- File .env.example presente; nessun file .env locale rilevato.

## Differenze e incoerenze da risolvere prima dell'importazione

1. docs/REGISTRO_EVIDENZE_POSTGRESQL.md è non allineato allo snapshot: dichiara il branch recovery/checkpoint-12-postgres, PR #1 e migrazioni 001–010, mentre l'archivio contiene le migrazioni 001–013.
2. Nell'archivio mancano docs/GATE_RILASCIO.md e scripts/staging/run-smoke.sh, presenti nel branch GitHub di integrazione.
3. I test server/test/multi-tenant-negative.integration.test.ts e server/test/export-json.integration.test.ts contengono rispettivamente 34 e 18 dichiarazioni it/test; i corrispondenti file del branch GitHub precedentemente confrontato ne contengono 25 e 10. Il numero maggiore non dimostra da solo correttezza o maggiore maturità.
4. Altri file differiscono tra ZIP e branch GitHub, inclusi package.json, server/src/postgres-authentication.ts, server/src/postgres-readonly-verification.ts e scripts/staging/backup.sh. È necessario un confronto puntuale prima di scegliere quale versione mantenere.
5. Il registro di evidenze non può essere considerato aggiornato finché non viene riallineato a codice, migrazioni e CI effettivamente verificati.

## Controlli di sicurezza preliminari sull'archivio

- Non sono stati trovati file .env locali.
- Una scansione per marker comuni di chiavi private, token GitHub, access key AWS e chiavi Stripe live non ha restituito corrispondenze.
- La scansione è euristica e limitata: non costituisce una verifica completa di segreti, credenziali, dati personali o licenze.

## Stato delle verifiche

- L'archivio è stato ispezionato staticamente; non è stato installato né eseguito integralmente.
- La CI verde del branch integration/staging-additions-hardening si riferisce ai commit GitHub di quel branch, non ai byte di questo ZIP.
- Non sono state eseguite migrazioni, connessioni al database Neon, prove di backup/restore su database reali o deploy.
- Nessuna conclusione di production ready è supportata da questa verifica.

## Azioni consigliate

1. Conservare lo ZIP come snapshot immutabile e importarlo solo in un branch dedicato.
2. Confrontare i file divergenti, mantenendo una tabella di provenienza e motivazione per ogni scelta.
3. Ripristinare o sostituire consapevolmente i due file mancanti, senza copiare automaticamente versioni non verificate.
4. Aggiornare il registro evidenze soltanto dopo aver ripetuto CI e test sul commit risultante.
5. Eseguire test locali con PostgreSQL isolato e dati sintetici; non usare database aziendali o remoti.

## Precisazione sul conteggio delle suite — 16 novembre 2026

È stato ricalcolato il numero delle dichiarazioni `it(...)` / `test(...)` direttamente sui due file contenuti nell'archivio identificato dallo SHA-256 riportato sopra:

- `server/test/multi-tenant-negative.integration.test.ts`: 34 dichiarazioni.
- `server/test/export-json.integration.test.ts`: 18 dichiarazioni.

Il registro PostgreSQL presente nel branch di integrazione riportava in una sezione storica 17 dichiarazioni per la seconda suite: quel valore è da considerare superato per il conteggio dello ZIP. Il conteggio misura le dichiarazioni sintattiche individuate, non prova che i test siano eseguibili, corretti o equivalenti ai test attuali del branch. L'archivio non è stato installato né eseguito.
