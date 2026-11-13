# Distribuzione in produzione

## Architettura del ramo

Il comando standard `npm start` avvia il processo API PostgreSQL compilato. Il client Vite produce file statici in `client/dist`; il server Express non serve automaticamente questi file. In produzione occorre pubblicare il client dietro un web server e inoltrare `/api/` al processo Node, mantenendo interfaccia e API sulla stessa origine HTTPS perché l'autenticazione usa cookie same-origin.

Non sono presenti un Dockerfile, un manifest di hosting o una pipeline di deploy: questa guida definisce il contratto operativo, non certifica un ambiente già distribuito.

## Configurazione

Impostare tramite ambiente o secret manager:

- `NODE_ENV=production`
- `DATABASE_URL`: connessione del ruolo runtime dedicato, non proprietario e senza `BYPASSRLS`.
- `APP_ORIGIN`: origine pubblica HTTPS esatta, senza percorso, ad esempio `https://app.example.it`.
- `LOGIN_RATE_LIMIT_SECRET`: almeno 32 caratteri casuali, persistente tra riavvii.
- `PORT`: porta del processo API.

Non usare la connessione amministrativa delle migrazioni nel processo HTTP. Non inserire segreti nel repository. Il server esegue un preflight read-only e si rifiuta di partire se lo storico delle migrazioni è mancante o divergente, o se il ruolo runtime non rispetta i privilegi attesi.

## Reverse proxy Nginx di riferimento

Adattare host, certificati e percorsi all'ambiente reale. TLS deve terminare prima di esporre il servizio.

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

Non abilitare cache condivisa sulle API: le risposte contengono dati organizzativi. Non configurare CORS permissivo; il client usa same-origin e il server verifica `Origin` sulle scritture.

## Migrazioni e avvio

Le migrazioni non vengono eseguite automaticamente dal processo HTTP.

1. Verificare destinazione, ruolo e backup ripristinabile.
2. Eseguire `npm run db:migrate -- --check` con una connessione autorizzata a leggere lo storico.
3. Applicare migrazioni solo con un ruolo amministrativo separato e dopo approvazione operativa.
4. Eseguire bootstrap esclusivamente su un database vuoto, seguendo [BOOTSTRAP_POSTGRESQL.md](BOOTSTRAP_POSTGRESQL.md).
5. Avviare `npm start` con la sola connessione del ruolo applicativo.
6. Verificare `GET /api/health` e i flussi browser di accesso, invito, revoca e logout.

## Limiti operativi aperti

- Il pool è dimensionato a 5 connessioni per processo: pianificare il numero di istanze in base al limite del database.
- Il rate limiting usa l'indirizzo TCP del peer. Dietro un reverse proxy, il peer può essere il proxy per tutti gli utenti; prima di traffico reale serve una soluzione IP basata su proxy fidati, senza fidarsi genericamente di `X-Forwarded-For`.
- Non è ancora documentata una retention schedulata per i tentativi di login.
- `/api/health` controlla API e database, ma non distingue liveness e readiness né sostituisce metriche e allarmi.
- Non risultano ancora provati backup/restore point-in-time, monitoraggio, rotazione segreti o incident response.
- Gli inviti generano link monouso da condividere manualmente; non è configurato un provider email.
- Non sono ancora documentati test browser end-to-end completi né un ambiente staging verificato.

## Gate prima di un pilot

- [ ] CI verde sul commit esatto da rilasciare.
- [ ] Staging isolato con database e dati sintetici.
- [ ] TLS, cookie Secure, origine e reverse proxy verificati da browser.
- [ ] Login, sessione, logout, invito, accettazione, revoca e scadenza verificati end-to-end.
- [ ] Isolamento tra organizzazioni e permessi verificati per tutti i ruoli.
- [ ] Importazione, esportazione, limiti e rollback verificati.
- [ ] Backup e ripristino realmente provati.
- [ ] Rate limiting dietro proxy, retention e monitoraggio collaudati.
- [ ] Procedura incident response disponibile.

Finché questi gate non sono completati, il ramo è una base applicativa PostgreSQL con verifiche automatiche, non un SaaS pronto a ricevere dati aziendali reali o a essere venduto come servizio pronto all'uso.
