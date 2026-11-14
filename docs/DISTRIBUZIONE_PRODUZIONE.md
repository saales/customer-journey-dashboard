# Distribuzione in produzione — procedura controllata

## Prerequisiti

- Database PostgreSQL di produzione identificato e accessibile.
- Backup verificato e prova di ripristino completata.
- Ruolo owner separato dal ruolo runtime `percorso_app` (NOINHERIT, non superuser, senza BYPASSRLS).
- `DATABASE_URL`, `APP_ORIGIN` HTTPS e `LOGIN_RATE_LIMIT_SECRET` configurati come secret di ambiente.
- Per recupero password e inviti automatici: `RESEND_API_KEY` e `EMAIL_FROM` configurati; senza questi valori gli inviti restano condivisibili manualmente e il recupero password non invia email.
- `TRUSTED_PROXY_IPS` valorizzato con gli IP/CIDR esatti dei reverse proxy fidati; lasciare vuoto solo se il processo riceve direttamente il traffico client.
- DNS, TLS, reverse proxy e monitoraggio pronti.

## Frontend e reverse proxy

La build produce il frontend statico in `client/dist`; il processo Node avvia esclusivamente l'API sulla porta 3001. In produzione servire il frontend tramite un web server/reverse proxy HTTPS sullo stesso dominio, inoltrando `/api/` al processo Node. Il file `deploy/nginx/percorso-cliente.conf.example` fornisce una configurazione di partenza per Nginx.

1. Eseguire `npm ci` e `npm run build` in fase di rilascio; pubblicare `client/dist` nella directory configurata come root Nginx e avviare il server Node come servizio gestito (systemd o orchestratore), non in una shell interattiva.
2. Configurare dominio, certificati TLS e percorso statico nel file Nginx di esempio; validare con `nginx -t` prima del reload.
3. Se Nginx è sullo stesso host, impostare `TRUSTED_PROXY_IPS=127.0.0.1/32,::1/128`; se è in un container o su un host separato, usare esclusivamente gli IP/CIDR effettivi del proxy. Non fidarsi di reti client o di proxy non controllati.
4. Configurare `APP_ORIGIN` con l'origine HTTPS esatta del frontend, senza percorso.
5. Eseguire il preflight read-only sul database di destinazione: `npm run db:migrate -- --check`.
6. Verificare che le migrazioni applicate e i checksum coincidano con il ramo rilasciato.
7. Se esistono migrazioni pendenti, verificare backup, piano di rollback e approvazione prima di `npm run db:migrate`.
8. Eseguire il bootstrap solo su database vuoto e con credenziali amministrative separate.
9. Configurare il server con il ruolo runtime e avviare `npm start`. Lo startup ripete il controllo read-only e si arresta se il ruolo/schema non sono sicuri.
10. Verificare `/api/health`, login, sessione, permessi, inviti, clienti, import, funnel, export e isolamento cross-tenant.
11. Abilitare il traffico solo dopo smoke test e controlli di osservabilità.

## Rollback

Non eliminare tabelle o modificare manualmente lo storico migrazioni. Se il deploy fallisce, ripristinare il precedente artefatto applicativo compatibile e seguire il runbook di restore PostgreSQL. Le migrazioni non sono automaticamente reversibili: il rollback schema deve essere pianificato per ogni release.

## Stato

Questa procedura è un runbook operativo; non costituisce prova di deploy o collaudo in produzione. Nessun deploy o intervento sul database remoto è stato eseguito da questa attività.