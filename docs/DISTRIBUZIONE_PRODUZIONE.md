# Distribuzione in produzione — procedura controllata

## Prerequisiti

- Database PostgreSQL di produzione identificato e accessibile.
- Backup verificato e prova di ripristino completata.
- Ruolo owner separato dal ruolo runtime `percorso_app` (NOINHERIT, non superuser, senza BYPASSRLS).
- `DATABASE_URL`, `APP_ORIGIN` HTTPS e `LOGIN_RATE_LIMIT_SECRET` configurati come secret di ambiente.
- DNS, TLS, reverse proxy e monitoraggio pronti.

## Procedura

1. Eseguire il preflight read-only sul database di destinazione: `npm run db:migrate -- --check`.
2. Verificare che le migrazioni applicate e i checksum coincidano con il ramo rilasciato.
3. Se esistono migrazioni pendenti, verificare backup, piano di rollback e approvazione prima di `npm run db:migrate`.
4. Eseguire il bootstrap solo su database vuoto e con credenziali amministrative separate.
5. Configurare il server con il ruolo runtime e avviare `npm start`. Lo startup ripete il controllo read-only e si arresta se il ruolo/schema non sono sicuri.
6. Verificare `/api/health`, login, sessione, permessi, inviti, clienti, import, funnel, export e isolamento cross-tenant.
7. Abilitare il traffico solo dopo smoke test e controlli di osservabilità.

## Rollback

Non eliminare tabelle o modificare manualmente lo storico migrazioni. Se il deploy fallisce, ripristinare il precedente artefatto applicativo compatibile e seguire il runbook di restore PostgreSQL. Le migrazioni non sono automaticamente reversibili: il rollback schema deve essere pianificato per ogni release.

## Stato

Questa procedura è un runbook operativo; non costituisce prova di deploy o collaudo in produzione. Nessun deploy o intervento sul database remoto è stato eseguito da questa attività.