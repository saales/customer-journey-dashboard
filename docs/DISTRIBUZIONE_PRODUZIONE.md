# Distribuzione in produzione

## Architettura supportata dal codice attuale

Il repository produce due artefatti distinti:

- **Interfaccia web:** build Vite in `client/dist`, da pubblicare come file statici.
- **API:** processo Node.js avviato con `npm start`, in ascolto sulla porta configurata (predefinita 3001).

Il client usa URL relativi `/api/...` e cookie `same-origin`. In produzione, browser, file statici e API devono quindi essere esposti sotto **la stessa origine HTTPS**. Il server Express attuale non serve automaticamente `client/dist`: occorre un web server/reverse proxy davanti al processo Node.

Nel repository non sono presenti un Dockerfile, un manifest di hosting o una pipeline di deploy. Questa procedura descrive il contratto di distribuzione, non attesta che esista già un ambiente pubblicato.

## Preparazione del rilascio

1. Usare Node.js 20 o 22 e installare le dipendenze con `npm ci`.
2. Eseguire `npm test` e `npm run build`.
3. Pubblicare `client/dist` su un web server statico.
4. Avviare il server con `npm start`, sotto un process manager o orchestratore.
5. Configurare il reverse proxy: `/api/` verso Node e le altre rotte verso `client/dist/index.html`.
6. Impostare `APP_ORIGIN` all'origine pubblica esatta, ad esempio `https://app.example.it` (senza percorso).
7. Impostare `NODE_ENV=production`, `DATABASE_URL`, `LOGIN_RATE_LIMIT_SECRET` (almeno 32 caratteri casuali) e `PORT` tramite ambiente o secret manager, mai nel repository.
8. Usare un ruolo PostgreSQL applicativo dedicato, non proprietario dello schema, non superuser e senza `BYPASSRLS`. Non usare il ruolo di migrazione per il processo HTTP.

## Esempio Nginx

Adattare certificati, host, percorsi e indirizzo del processo all'ambiente reale. La terminazione TLS deve essere attiva prima di esporre l'applicazione.

```nginx
server {
    listen 443 ssl;
    server_name app.example.it;
    root /srv/percorso-cliente/client/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
        client_max_body_size 13m;
        proxy_read_timeout 60s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Non abilitare cache condivisa per le risposte `/api/`: contengono dati specifici dell'organizzazione e il server imposta `Cache-Control: no-store`. Non configurare CORS permissivo: l'applicazione si aspetta richieste same-origin e verifica `Origin` sulle mutazioni.

## Migrazioni e avvio

Le migrazioni non vengono eseguite automaticamente dal processo HTTP.

- Verificare destinazione PostgreSQL, ruolo e backup ripristinabile.
- Eseguire `npm run db:migrate -- --check` con il ruolo autorizzato a leggere lo storico.
- Applicare le migrazioni solo tramite una fase operativa separata e approvata, con il ruolo amministrativo dedicato.
- Avviare il runtime con il ruolo applicativo. Il preflight in avvio verifica lo storico e i privilegi senza modificare lo schema.
- Verificare `GET /api/health`: risponde positivamente solo se il database è raggiungibile.

Non eseguire bootstrap su un database esistente. Il bootstrap è riservato a un database vuoto e richiede il flag esplicito documentato in [BOOTSTRAP_POSTGRESQL.md](BOOTSTRAP_POSTGRESQL.md).

## Limiti operativi da risolvere prima di scalare

- Il pool PostgreSQL ha massimo 5 connessioni per processo. Dimensionare le istanze rispetto al limite del database, riservando margine per migrazioni e manutenzione.
- Il rate limiting del login usa l'indirizzo TCP del peer e lo stato PostgreSQL. Dietro un reverse proxy, il peer può essere l'indirizzo del proxy per tutti gli utenti: prima di esporre il servizio a traffico reale, progettare e verificare la gestione dell'IP client tramite proxy fidati. Non fidarsi genericamente di `X-Forwarded-For` e non abilitare `trust proxy` senza una lista precisa di proxy fidati.
- La tabella dei tentativi di login richiede una politica verificata di pulizia/conservazione: non è documentato un processo schedulato di retention.
- `/api/health` è un controllo combinato API/database, non distingue readiness e liveness e non sostituisce metriche, allarmi o monitoraggio.
- Non è documentata una procedura automatizzata di backup, restore point-in-time, rotazione segreti o risposta agli incidenti.
- Inviti e recupero account via email non sono implementati: la gestione membri amministra membership già esistenti, non realizza un onboarding aziendale completo.

## Verifiche obbligatorie prima di un pilot

- [ ] Build e test CI verdi sul commit esatto da rilasciare.
- [ ] Ambiente staging separato e database verificato.
- [ ] TLS, cookie Secure, origine esatta e reverse proxy collaudati da browser.
- [ ] Login, sessione, logout, scadenza e revoca verificati end-to-end.
- [ ] Test negativi tra organizzazioni e per tutti i ruoli.
- [ ] Importazione, esportazione, limiti e rollback verificati.
- [ ] Backup e ripristino provati con evidenza registrata.
- [ ] Rate limiting dietro proxy e politica di retention collaudati.
- [ ] Monitoraggio, allarmi, log e procedura di incident response disponibili.
- [ ] Inviti e recupero account implementati prima di considerare completo l'onboarding aziendale.

Fino al completamento di queste verifiche, il repository rappresenta una base applicativa PostgreSQL testata in CI, non una distribuzione SaaS pronta per dati aziendali reali.
