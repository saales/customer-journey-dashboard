# Registro delle evidenze PostgreSQL

**Aggiornato:** 2026-11-13  
**Branch:** `recovery/checkpoint-12-postgres`  
**Commit di riferimento:** `68f4319097d28d7be490b62f7a7bfa2b8e6a2c58`.

Questo registro separa ciò che è stato verificato nel repository e nella CI da ciò che proviene da riepiloghi storici o resta da verificare. Non certifica lo stato del database Neon.

## Evidenze verificate nel codice Git

| Affermazione | Evidenza | Stato |
|---|---|---|
| Il runtime applicativo usa ancora SQLite | `server/src/index.ts`, `server/src/app.ts`, `server/src/db.ts` | Verificato nel branch |
| Il pool PostgreSQL non è ancora il repository usato dalle route | `server/src/postgres.ts`; route e query correnti restano basate su SQLite | Verificato nel branch |
| È presente un'ispezione read-only dei cataloghi PostgreSQL | `server/src/postgres-schema-inspection.ts` | Verificato nel branch |
| L'ispezione avvia `BEGIN READ ONLY`, interroga cataloghi/metadati, esegue `ROLLBACK` e rilascia il client | Implementazione di `inspectPostgresSchema` | Verificato nel branch |
| L'ispezione non legge righe applicative | Le query leggono database identity, cataloghi, `information_schema`, ruolo corrente e presenza della tabella migrazioni | Verificato nel codice; non è una certificazione di sicurezza esterna |
| Il report esclude gli schemi di sistema e quelli con prefisso `pg_` nelle query di catalogo | Query tables, columns, constraints, indexes e policies | Verificato nel codice |
| I test controllano alias SQL, filtri schema e comportamento read-only con mock | `server/test/postgres-schema-inspection.test.ts` | Verificato nel branch |
| La CI dispone di PostgreSQL 16 effimero | `.github/workflows/ci.yml` | Verificato nella configurazione |
| Il test d'integrazione crea uno schema/tabella temporanei, attiva RLS e verifica proprietario, colonne, PK, indice e policy | `server/test/postgres.integration.test.ts` | Verificato nel branch |
| Il test esegue l'ispezione come ruolo `NOLOGIN`, non superuser e senza `BYPASSRLS` | `server/test/postgres.integration.test.ts` | Verificato in CI run [43418128323](https://github.com/saales/customer-journey-dashboard/actions/runs/43418128323), Node 20 e 22 |
| L'ispezione limita tabelle, colonne, vincoli, indici e policy agli oggetti per cui il ruolo corrente ha `SELECT` | `server/src/postgres-schema-inspection.ts` e test d'integrazione con `private_probe` senza grant | Verificato in CI run [43418128323](https://github.com/saales/customer-journey-dashboard/actions/runs/43418128323), Node 20 e 22 |
| Test e build sono passati su Node 20 e Node 22 sul commit con ruolo limitato | CI run [43417529693](https://github.com/saales/customer-journey-dashboard/actions/runs/43417529693), entrambi i job conclusi `success` | Verificato su CI |
| La PR resta aperta in bozza e `main` non è stata modificata | PR #1, branch e base verificati dopo il commit | Verificato al momento dell'aggiornamento |

## Evidenze storiche non confermate

Un riepilogo operativo precedente riferisce:
- una migrazione Neon 001 con checksum parziale `483595e...`;
- una migrazione 002 relativa a `sessions.organization_id`;
- un modello storico con organizzazioni, utenti, membership, inviti, sessioni e audit log.

Queste informazioni non sono state ricostruite da file SQL originali né verificate interrogando Neon. Non devono essere usate per generare DDL, dichiarare migrazioni applicate o affermare che lo schema remoto abbia quelle caratteristiche.

## Elementi non verificati / non implementati

- Stato, schema, migrazioni e checksum correnti di Neon: **non verificati**.
- SQL originali e checksum completi delle migrazioni storiche: **non recuperati**.
- Autenticazione, sessioni, inviti e autorizzazione tenant runtime: **non implementati**.
- Repository PostgreSQL per le route applicative: **non implementati**.
- Isolamento multi-tenant end-to-end delle API: **non implementato**.
- Il report di ispezione filtra tabelle, colonne, vincoli, indici e policy tramite `has_table_privilege(..., 'SELECT')`; il test PostgreSQL reale conferma che `private_probe`, senza grant, non compare nel report.
- Prova di upgrade da una copia dello schema storico: **bloccata finché la baseline non è disponibile**.
- Connessione o modifica del database Neon: **non eseguita**.

## Prossimi passi sicuri

1. Recuperare la baseline SQL storica e verificare lo schema di destinazione in sola lettura prima di progettare migrazioni.
2. Recuperare la baseline SQL storica e verificare lo schema di destinazione in sola lettura prima di progettare migrazioni.
3. Solo dopo il confronto della baseline, definire migrazioni nuove e repository PostgreSQL.

**Regola:** nessuna migrazione eseguibile e nessuna modifica a Neon finché la provenienza della baseline non è verificata.
