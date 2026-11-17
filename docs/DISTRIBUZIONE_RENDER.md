# Deploy su Render con Neon

Questa applicazione viene pubblicata come **un unico Render Web Service**: Express serve sia `client/dist` sia le API `/api/*`. In questo modo frontend e API condividono origine HTTPS e cookie di sessione `HttpOnly; Secure; SameSite=Strict`.

## Blueprint

Il file `render.yaml` definisce:
- runtime Node;
- regione Frankfurt, vicina al progetto Neon in `eu-central-1`;
- build `npm ci && npm run build`;
- start `npm start`;
- health check `/api/health`;
- deploy automatico solo quando i controlli GitHub sono superati.

Il server usa `HOST=0.0.0.0` e la porta Render `10000`. Non avvia migrazioni allo startup: il preflight è read-only e blocca il servizio se schema/checksum o ruolo runtime non sono validi.

## Variabili Render

Il Blueprint genera `LOGIN_RATE_LIMIT_SECRET`. Impostare in Render:
- `APP_ORIGIN`: origine HTTPS esatta del servizio Render o del dominio personalizzato, senza slash finale;
- `DATABASE_URL`: URL PostgreSQL del branch Neon scelto, usando il ruolo runtime `percorso_app`, endpoint pooled (`-pooler`) e `sslmode=verify-full`;
- `RESEND_API_KEY` e `EMAIL_FROM`: facoltative, ma vanno configurate entrambe per email inviti e recupero password.

Non usare la password del proprietario del database in `DATABASE_URL`. Non incollare URL o password in GitHub, issue, log o chat.

## Ordine di rilascio consigliato

1. Creare/collegare il Web Service Render usando il repository e il Blueprint. Per il primo collaudo selezionare il branch di staging del codice; per la produzione usare `main` dopo il merge approvato.
2. Collegare `DATABASE_URL` al branch Neon di staging, non a `production`.
3. Eseguire preflight, backup, migrazioni approvate, bootstrap del tenant sintetico e verifica read-only con il ruolo runtime. Eseguire Playwright/Smoke test e prova di ripristino prima del GO.
4. Verificare su Render `/api/health`, login, inviti, sessione, ruoli, import/export e isolamento cross-tenant.
5. Solo dopo il GO, preparare il branch Neon di produzione: snapshot/backup, ruolo runtime separato, preflight e approvazione delle migrazioni. La produzione non viene aggiornata dal Blueprint e non va usata per il primo deploy.
6. Aggiornare `APP_ORIGIN` con il dominio definitivo e `DATABASE_URL` con il branch di produzione soltanto durante il cutover pianificato.

## Note Render

Render termina TLS al proprio edge e inoltra HTTP al container. Il server usa il valore `CF-Connecting-IP` fornito dall'edge Render/Cloudflare per i bucket rate-limit solo quando l'ambiente segnala `RENDER=true`; fuori da Render non si fida di questo header. Questo evita di attribuire tutte le richieste al proxy e di fidarsi di un header client arbitrario.

Il piano Free può sospendere un Web Service inattivo e introdurre cold start; per un'applicazione di produzione scegliere un piano sempre attivo adeguato al carico.
