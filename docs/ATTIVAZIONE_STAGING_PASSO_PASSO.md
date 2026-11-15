# Attivazione staging — attività del titolare e checklist tecnica

Questo documento separa ciò che deve essere predisposto dal titolare dell'ambiente da ciò che va verificato nel repository. L'ambiente staging deve essere isolato dalla produzione e deve usare dati sintetici. Non condividere password, token, URL completi di connessione o chiavi API in chat, ticket o repository.

## Ordine di lavoro

### Passo 1 — scegliere dominio e hosting (titolare)

- [ ] Scegliere un dominio o sottodominio dedicato, ad esempio `staging.example.it`.
- [ ] Scegliere un VPS/servizio cloud che supporti Node.js 20 o 22 e PostgreSQL gestito.
- [ ] Scegliere una regione UE/SEE, salvo diversa esigenza documentata.
- [ ] Creare un ambiente staging separato; non usare il dominio pubblico del prodotto e non inserire dati di clienti reali.
- [ ] Annotare provider, regione, dominio, IP pubblico del server e IP/CIDR del reverse proxy.

Non attivare ancora il traffico di utenti esterni.

### Passo 2 — creare il database Neon staging (titolare)

- [ ] Creare un progetto/database Neon dedicato esclusivamente allo staging.
- [ ] Annotare il nome esatto del database e la regione.
- [ ] Creare due ruoli distinti secondo `docs/CONFIGURAZIONE_RUOLI_POSTGRESQL.md`: proprietario/migrazioni `percorso_owner` e runtime `percorso_app`.
- [ ] Impostare il ruolo runtime come `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.
- [ ] Conservare le due stringhe di connessione in un password manager/secret manager; mai inviarle in chat.
- [ ] Verificare che la connessione usi TLS e che il database sia vuoto prima del bootstrap.

Il runtime HTTP deve usare solo la connessione `percorso_app`. Le credenziali owner sono riservate a migrazioni e operazioni amministrative.

### Passo 3 — predisporre il server e il DNS (titolare)

- [ ] Creare una VM/servizio Linux con accesso amministrativo controllato.
- [ ] Installare Node.js 22 LTS (Node.js 20 è supportato dalla CI, ma per un nuovo ambiente scegliere la versione 22).
- [ ] Installare Nginx e configurare il DNS del sottodominio verso il server.
- [ ] Abilitare HTTPS con certificato valido.
- [ ] Consentire dall'esterno solo HTTPS (443) e, se indispensabile, SSH limitato agli IP amministrativi; la porta API 3001 non deve essere pubblica.
- [ ] Preparare una directory di deploy e un servizio gestito (systemd o orchestratore), non un processo avviato da una shell interattiva.
- [ ] Annotare IP/CIDR effettivo del reverse proxy per `TRUSTED_PROXY_IPS`.

La configurazione di partenza è `deploy/nginx/percorso-cliente.conf.example`. Va personalizzata per dominio, certificati e directory di deploy e validata con `nginx -t`.

### Passo 4 — configurare email (titolare)

- [ ] Creare un account Resend oppure confermare che l'email sarà temporaneamente disabilitata.
- [ ] Verificare il dominio mittente e configurare i record DNS richiesti dal provider (SPF, DKIM e DMARC).
- [ ] Creare una chiave API limitata al progetto.
- [ ] Scegliere un mittente, ad esempio `Percorso Cliente <noreply@tuodominio.it>`.

Le credenziali si inseriscono nel secret manager, non in `.env.example` o in Git. Senza Resend configurato, inviti automatici e recupero password via email non sono collaudabili end-to-end.

### Passo 5 — preparare i segreti di staging (titolare)

Impostare nel secret manager dell'hosting queste variabili. I valori segreti vanno generati e custoditi dal titolare:

| Variabile | Valore da impostare |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URL TLS del ruolo `percorso_app` |
| `APP_ORIGIN` | Origine HTTPS esatta, ad esempio `https://staging.example.it` |
| `LOGIN_RATE_LIMIT_SECRET` | Segreto casuale dedicato di almeno 32 caratteri |
| `TRUSTED_PROXY_IPS` | IP/CIDR esatti del proxy fidato; vuoto solo se il processo riceve direttamente il traffico |
| `PORT` | `3001` |
| `DB_POOL_MAX` | `5` come valore iniziale |
| `API_RATE_LIMIT_MAX` | `1200` come valore iniziale |
| `RESEND_API_KEY` | Chiave Resend, se email attive |
| `EMAIL_FROM` | Mittente verificato Resend, se email attive |

Non inserire `BOOTSTRAP_DATABASE_URL` nel runtime HTTP. Le variabili `BOOTSTRAP_*` sono temporanee e servono solo al comando iniziale, poi vanno rimosse.

### Passo 6 — comunicare i soli dati non segreti (titolare)

Quando i passi 1–5 sono pronti, comunicare al team tecnico soltanto:

- provider hosting e regione;
- dominio staging;
- nome esatto del database (non la stringa di connessione);
- conferma che i ruoli owner e runtime sono stati creati;
- IP/CIDR del reverse proxy;
- se Resend è attivo e quale mittente verificato è stato scelto;
- se esiste uno spazio backup separato e cifrato.

Non inviare password, URL completi, chiavi API, certificati privati o dati personali.

## Attività tecniche successive — da eseguire solo dopo i passi 1–6

1. Verificare l'accessibilità TLS del database staging e il nome effettivo del database con il preflight read-only.
2. Controllare lo stato delle migrazioni con `npm run db:migrate -- --check` usando la connessione owner.
3. Verificare backup e procedura di ripristino su un database isolato prima di applicare migrazioni a un ambiente con dati.
4. Applicare le migrazioni con `npm run db:migrate` usando il ruolo owner, dopo aver approvato il piano.
5. Eseguire il bootstrap una tantum solo su database staging vuoto, con `BOOTSTRAP_DATABASE_URL` e le variabili `BOOTSTRAP_*` richieste da `docs/BOOTSTRAP_POSTGRESQL.md`, tramite `npm run db:bootstrap -- --confirm-empty-database`.
6. Rimuovere subito le variabili bootstrap e avviare l'API con il solo ruolo runtime.
7. Pubblicare `client/dist` e configurare Nginx; avviare il servizio Node gestito.
8. Eseguire `scripts/staging/run-smoke.sh` con i parametri richiesti dalla relativa guida e verificare login, ruoli, CSRF, isolamento tenant, export e logout.
9. Provare inviti e recupero password con caselle email controllate.
10. Eseguire backup e restore reali, verificare health check, log, allarmi e limiti sotto carico.
11. Registrare tutte le evidenze e chiudere i gap privacy/contrattuali prima di un pilot con dati reali.

## Regole di sicurezza

- Non eseguire bootstrap, migrazioni, cancellazioni tenant o restore su produzione durante la preparazione dello staging.
- Non usare dati reali di clienti per il collaudo.
- Non esporre la porta 3001 a Internet.
- Non usare il ruolo owner come `DATABASE_URL` del servizio HTTP.
- Non considerare `--confirm-backup` una verifica automatica: è solo una conferma esplicita dell'operatore dopo una prova effettiva.
- Nessun ambiente è considerato pronto finché il collaudo staging non è stato completato e le evidenze non sono state registrate.
