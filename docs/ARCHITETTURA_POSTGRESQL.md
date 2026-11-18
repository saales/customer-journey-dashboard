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
- Migrazioni versionate 001–013, checksum, advisory lock e preflight read-only, inclusa la verifica dei privilegi sul rate limiter API.
- Recupero password con token monouso hashati e scadenza; email transazionali via Resend quando configurato.
- Verifica del ruolo runtime e dei privilegi minimi.

## Avvio sicuro

Il server non applica migrazioni automaticamente. Verifica lo storico e il ruolo PostgreSQL; se esistono migrazioni pendenti, checksum divergenti o privilegi non conformi, il processo non apre la porta HTTP.

Per i database remoti in produzione, il processo richiede `sslmode=verify-full`: TLS protegge il traffico e il driver verifica il certificato e il nome host del server.

## Stato del database remoto

Lo staging Neon `staging-pre-release` è stato verificato: migrazioni 001–013 e checksum applicati, RLS attiva sulle sei tabelle tenant previste con sette policy, ruolo runtime separato e non privilegiato; il preflight del runtime è passato. Il servizio Render di staging è attivo e il flusso applicativo è stato collaudato manualmente con dati sintetici. Il deploy attivo usa il commit `284182e`; il commit di branch `c61e09b` aggiunge soltanto un test E2E e non modifica il codice applicativo. Non è stata eseguita alcuna migrazione né modifica su Neon production o sul servizio Render production. Non sono stati verificati trasferimenti di dati preesistenti, backup/restore reale, invio email, carico o ogni combinazione route × tenant.

## Limiti di rilascio

La CI include un percorso browser end-to-end con Playwright/Chromium su PostgreSQL temporaneo per i quattro ruoli e alcuni casi cross-tenant. Prima del rilascio restano necessari ulteriori casi di isolamento, backup/restore, test di carico, osservabilità, staging e verifica del database remoto. La consegna email reale non è stata verificata.
