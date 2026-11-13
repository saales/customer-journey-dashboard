# Percorso Cliente — stato prodotto e piano di rilascio

## 1. Visione del prodotto

Percorso Cliente è una piattaforma B2B multi-organizzazione per analizzare acquisizione, avanzamento nel funnel e conversione dei clienti. Il runtime applicativo usa PostgreSQL come unico database; non esiste una modalità dimostrativa o un archivio alternativo nel ramo corrente.

Il prodotto deve poter essere presentato a Deloitte e ad altre imprese come soluzione indipendente, con identità visiva originale. Non deve utilizzare marchi, loghi, template proprietari o suggerire affiliazioni/approvazioni da parte di Deloitte o di altri soggetti.

Non dichiarare risultati di clienti reali, disponibilità in produzione, certificazioni o livelli di servizio senza evidenze verificabili.

## 2. Utenti e ruoli

| Ruolo | Permessi attesi |
|---|---|
| Admin | Gestisce organizzazione, utenti, inviti, impostazioni, dati e audit |
| Editor | Consulta e modifica clienti, eventi e importazioni |
| Analyst | Consulta dashboard, filtri, segmenti ed esportazioni |
| Viewer | Sola lettura delle viste autorizzate |

Ogni risorsa appartenente a un'organizzazione deve essere filtrata lato server tramite l'organizzazione ricavata dalla sessione autenticata. Non è sufficiente nascondere pulsanti nel frontend.

## 3. Ambito del prodotto vendibile

### Funzionalità fondamentali (MVP commerciale)

- Autenticazione, sessioni revocabili e inviti monouso con scadenza, revoca e accettazione atomica. Il recupero account e l’invio automatico delle email non sono ancora disponibili.
- Organizzazioni isolate e gestione dei ruoli.
- Dashboard funnel, KPI, andamento temporale e confronto canali.
- Gestione clienti ed eventi con paginazione e filtri.
- Importazione CSV con anteprima, validazione, deduplicazione e report degli errori.
- Esportazioni controllate e tracciate.
- Audit log per modifiche a clienti e funnel, importazioni, esportazioni CSV, membership e inviti; resta da valutare la copertura delle ulteriori operazioni amministrative e letture sensibili.
- Gestione organizzazione, utenti e preferenze.
- Nessun accesso dimostrativo o seed automatico nel runtime standard.
- Backup, ripristino, logging, monitoraggio e procedura di incident response.
- Interfaccia responsive, accessibile e con messaggi di errore comprensibili.

### Evoluzioni successive

- Connettori CRM e marketing automation.
- API pubbliche con token a permessi limitati e rate limiting.
- Analisi cohort e retention più avanzate.
- Report programmati e invio email.
- SSO aziendale (OIDC/SAML), MFA e provisioning SCIM.
- White-label e personalizzazione del branding per piani enterprise.
- Fatturazione, piani, limiti di utilizzo e self-service billing.
- Funzioni di collaborazione e commenti sui report.

Le evoluzioni non devono ritardare la messa in sicurezza del nucleo MVP.

## 4. Architettura e requisiti non negoziabili

- PostgreSQL deve essere il database effettivamente usato dall'applicazione, non soltanto una connessione di verifica.
- Le migrazioni devono essere incrementali, versionate e idempotenti; non modificare retroattivamente migrazioni già applicate.
- Tutte le query, join, conteggi, aggiornamenti, cancellazioni e importazioni devono applicare il tenant scope.
- Le operazioni multi-tabella devono essere transazionali.
- Il tenant deve essere determinato dalla sessione autenticata, mai accettato come tenant arbitrario dal client.
- Le sessioni devono usare token casuali, conservare solo hash lato database, cookie HttpOnly, Secure in produzione, SameSite appropriato, scadenza e revoca.
- Le mutazioni devono avere protezioni CSRF/origin coerenti e rate limiting condiviso tra istanze in produzione.
- Segreti e credenziali devono provenire da variabili ambiente o secret manager; mai committarli.
- Nessun account demo con password hardcoded e nessuna registrazione pubblica aperta.
- Il bootstrap del primo admin deve essere un comando CLI una tantum, documentato e non esposto via HTTP.
- I log non devono contenere password, token, cookie o dati personali non necessari.

## 5. Privacy, sicurezza e conformità

Prima di usare dati di imprese o persone reali, il rilascio deve prevedere una revisione legale e privacy adeguata al caso d'uso. In particolare:

- Mappatura dei dati trattati, finalità, basi giuridiche e tempi di conservazione.
- Ruoli privacy e accordi applicabili (ad esempio titolare/responsabile e DPA, quando pertinenti).
- Informative, gestione delle richieste degli interessati e procedure di cancellazione/esportazione.
- Minimizzazione dei dati e limitazione degli accessi.
- Valutazione di trasferimenti extra SEE, fornitori e sub-responsabili.
- Valutazione della necessità di DPIA in base ai trattamenti effettivi.
- Cifratura in transito e a riposo, gestione chiavi, backup protetti e test di ripristino.
- Verifica delle dipendenze, vulnerability scanning, aggiornamenti e gestione delle vulnerabilità.
- Test di isolamento tra tenant e test di autorizzazione per ogni ruolo.
- Piano di risposta agli incidenti e canale di segnalazione vulnerabilità.

Questo documento è una checklist di prodotto, non un parere legale né una certificazione di conformità.

## 6. Stato verificato e criteri di accettazione

### Implementato nel ramo corrente

- PostgreSQL è l’unico percorso di persistenza del server e il runtime HTTP standard avvia esclusivamente `postgres-server.ts`.
- Migrazioni versionate 001–009, controllo checksum e preflight dei privilegi del ruolo runtime, inclusi i privilegi del rate limiter API persistente.
- Sessioni opache, autenticazione, autorizzazione per ruolo e tenant scope nelle API.
- Dashboard, clienti, funnel, segmentazione, importazione, export CSV, gestione membri e inviti monouso.
- La CI esegue build e test su Node.js 20/22, applica le migrazioni 001–009 a PostgreSQL temporaneo, verifica i checksum e avvia il runtime con un ruolo non privilegiato. Su Node.js 22 esegue inoltre un percorso browser Playwright/Chromium con tenant sintetico: login admin, creazione cliente, aggiunta fase funnel, import/export CSV, invito e accettazione analista, export con ruolo analista, rifiuto server-side della lettura audit e della creazione cliente e logout con revoca sessione.

### Non ancora dimostrato / non disponibile

- Nessuna prova che il database remoto sia già migrato o che dati precedenti siano stati trasferiti.
- Nessun deploy o collaudo su un ambiente staging reale.
- Nessuna prova operativa di backup e ripristino.
- Il test browser copre un percorso end-to-end rappresentativo e il confine admin/analista; non sostituisce ancora la matrice completa dei quattro ruoli su tutte le API, i test cross-tenant esaustivi o i test di carico.
- Nessun invio automatico degli inviti, recupero password, MFA/SSO o billing.
- La CI verifica il ruolo runtime sul PostgreSQL temporaneo; il ruolo, lo schema e i checksum del database remoto non sono stati verificati.

### Criteri di accettazione

Il prodotto non è pronto per un pilot con dati reali finché non sono soddisfatti tutti i seguenti criteri:

1. Build client e server completate senza errori.
2. Test automatici eseguiti e verdi su database PostgreSQL di test.
3. Test d'integrazione per login, logout, scadenza e revoca sessioni.
4. Test negativi che dimostrino che un utente del tenant A non può leggere o modificare dati del tenant B, anche conoscendo gli ID.
5. Test dei quattro ruoli su tutte le API.
6. Test import CSV, duplicati, file malformati, limiti e rollback transazionale.
7. Migrazioni provate su database vuoto e su copia aggiornata dello schema.
8. Test end-to-end dei flussi principali.
9. Backup e ripristino provati; health check e logging verificati.
10. Nessun segreto, dato reale o account privilegiato nel repository.
11. Documentazione di installazione, configurazione, aggiornamento, backup, ripristino e gestione incidenti.
12. Verifica manuale di accessibilità, responsive e browser supportati.

## 7. Strategia di rilascio

| Fase | Obiettivo | Risultato |
|---|---|---|
| 0. Stabilizzazione | Recuperare e verificare lo stato attuale | Build/test riproducibili e inventario dei gap |
| 1. Core SaaS | PostgreSQL, migrazioni, auth, tenant isolation, ruoli | MVP sicuro in ambiente staging |
| 2. Prodotto | Import/export, admin, audit, UX, gestione errori | Pilot pronto con dati controllati |
| 3. Validazione | Demo e pilot con 2-3 aziende consenzienti | Feedback, metriche di utilizzo e priorità |
| 4. Commerciale | Hosting affidabile, contratti, privacy, supporto, pricing | Prima release a pagamento |
| 5. Crescita | Integrazioni, SSO, automazioni, report | Offerta per clienti più strutturati |

Non si deve passare alla fase successiva solo perché la precedente è stata implementata: servono test e criteri di accettazione documentati.

## 8. Ipotesi di modello commerciale da validare

Non fissare prezzi definitivi prima delle interviste. Possibili metriche di packaging:

- Starter: una organizzazione, numero limitato di utenti e volumi.
- Professional: più utenti, segmentazione, import/export e report avanzati.
- Enterprise: SSO, audit avanzato, supporto prioritario, SLA e opzioni di hosting dedicate.

Il valore da validare con i clienti è il tempo risparmiato nell'analisi, la visibilità sulle perdite del funnel e la capacità di confrontare canali e coorti. Le metriche di vendita devono essere basate su pilot e casi d'uso reali, non su risultati sintetici.

## 9. Posizionamento e presentazione

La presentazione commerciale dovrà chiarire:

- Problema aziendale affrontato e destinatari.
- Demo con dataset dichiaratamente sintetico.
- Architettura, sicurezza e confini del prodotto.
- Casi d'uso misurabili da validare durante il pilot.
- Roadmap e modello di licenza.
- Stato reale delle funzionalità, distinguendo ciò che è disponibile da ciò che è pianificato.

Non usare loghi o nomi di clienti come referenze senza autorizzazione scritta. Non dichiarare certificazioni, conformità, SLA o test di sicurezza non effettivamente conseguiti.
