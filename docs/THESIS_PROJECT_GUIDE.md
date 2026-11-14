# Guida tecnica per la tesi — Percorso Cliente

> Documento di lavoro: descrive l'implementazione presente nel repository. Le valutazioni sperimentali, i risultati prestazionali e lo stato degli ambienti remoti devono essere completati con misurazioni riproducibili; non vanno presentati come già verificati.

## 1. Titolo di lavoro

**Progettazione e sviluppo di una piattaforma web multi-tenant per l'analisi del customer journey e del funnel di conversione**

## 2. Obiettivo

Il progetto realizza una piattaforma B2B che consente a un'organizzazione di consultare indicatori del percorso cliente, analizzare le conversioni per periodo e canale, gestire clienti ed eventi, configurare le fasi del funnel e controllare le attività amministrative.

L'obiettivo ingegneristico è integrare interfaccia web, API, persistenza relazionale, autorizzazione multi-tenant e verifiche automatiche in un sistema coerente e manutenibile.

## 3. Architettura applicativa

Il repository è organizzato in workspace npm:

- **Client:** React 18, TypeScript, Vite e Recharts. Gestisce presentazione, navigazione, filtri, grafici, importazione e gestione operativa.
- **Server:** Node.js, Express e TypeScript. Espone API HTTP, valida gli input, autentica le sessioni e applica i permessi.
- **Database:** PostgreSQL, accessibile tramite pg. Le migrazioni SQL sono versionate e verificate tramite storico e checksum.
- **Test e integrazione continua:** Vitest, Testing Library, PostgreSQL temporaneo e GitHub Actions su Node.js 20 e 22.

Schema logico:

```text
Utente
  |
  v
React + TypeScript (Vite)
  | HTTPS / API JSON
  v
Express + middleware
  |-- autenticazione e sessione
  |-- autorizzazione per ruolo/permesso
  |-- validazione input e protezioni HTTP
  |-- repository applicativi tenant-scoped
  v
PostgreSQL
  |-- organizzazioni e membri
  |-- clienti ed eventi funnel
  |-- configurazione fasi
  |-- sessioni e inviti
  |-- audit log
  |-- migrazioni versionate
```

## 4. Funzionalità principali

1. Dashboard con KPI relativi a visite, contatti, clienti, conversione e tempo medio all'acquisto.
2. Analisi del funnel, andamento temporale e risultati per canale.
3. Filtri per intervallo temporale e canale.
4. Gestione dei clienti e degli eventi associati alle fasi.
5. Configurazione, attivazione e riordinamento delle fasi del funnel.
6. Importazione e esportazione dei dati.
7. Segmentazione e confronto dei gruppi.
8. Gestione di membri, ruoli e inviti.
9. Registro delle attività amministrative.

## 5. Sicurezza e multi-tenancy

L'identità dell'organizzazione è ricavata dalla sessione autenticata e non da un identificativo arbitrario inviato dal client. Le API applicano middleware di autenticazione e autorizzazione; i repository ricevono il contesto organizzativo per limitare le operazioni. Il database utilizza Row Level Security sulle tabelle operative.

Le migrazioni sono esplicite: l'avvio dell'applicazione verifica la coerenza dello schema, ma non applica automaticamente DDL. Il ruolo runtime deve essere distinto dal ruolo proprietario e non deve possedere privilegi elevati.

Altre misure implementate comprendono cookie di sessione HttpOnly e SameSite, verifica dell'origine per le richieste mutative, limiti alle dimensioni delle richieste, rate limiting persistente, intestazioni HTTP di sicurezza e token d'invito monouso conservati sotto forma di hash.

Queste misure vanno comunque sottoposte a revisione indipendente e test in ambiente staging prima dell'utilizzo con dati reali.

## 6. Qualità del software

La pipeline automatizzata comprende test frontend e backend, build TypeScript, migrazioni 001–010 su PostgreSQL temporaneo, controllo dello storico/checksum e avvio del server con un ruolo non privilegiato. Su Node.js 22 include un percorso browser Playwright/Chromium con login admin, creazione cliente, funnel, import/export CSV, invito e accettazione di analista e viewer e verifica dei dinieghi HTTP 403 lato server. La matrice middleware verifica in modo esatto i permessi di admin, editor, analyst e viewer.

Per completare il capitolo sperimentale della tesi occorre raccogliere evidenze su:

- copertura dei test e casi limite;
- isolamento tra organizzazioni;
- tempi di risposta delle API su dataset sintetici di dimensione dichiarata;
- tempi di rendering e interazione nel browser;
- comportamento su viewport desktop, tablet e smartphone;
- accessibilità da tastiera e con tecnologie assistive;
- ripristino da backup e gestione degli errori operativi.

Non inserire valori di performance senza misurazioni ripetibili, indicando hardware, browser, versione software, dimensione dataset, numero di prove e statistiche (mediana e percentile 95).

## 7. Piano di valutazione sperimentale

| Esperimento | Metodo | Evidenza da allegare |
|---|---|---|
| Correttezza funzionale | Suite automatica + scenari manuali | Report test |
| Isolamento tenant | Due organizzazioni sintetiche e tentativi di accesso incrociato | Esiti HTTP e test DB |
| Performance API | Carico controllato su dataset sintetico | p50, p95, throughput, error rate |
| Performance frontend | Lighthouse e strumenti browser | LCP, INP, CLS e profilo CPU |
| Responsive | Viewport 390, 768, 1024 e 1440 px | Screenshot e checklist |
| Resilienza | Arresto DB, timeout, restore su ambiente isolato | Log e verbale prova |

## 8. Limiti e sviluppi futuri

Tra le attività da chiudere prima di un rilascio aziendale rientrano il collaudo in staging, l'analisi completa delle dipendenze, la verifica read-only del database remoto, il backup e il restore, estensione dei test browser ai percorsi non ancora coperti (in particolare editor) e ai casi cross-tenant, test di carico, monitoraggio e automazione dell'invio email per inviti e recupero account.

## 9. Struttura suggerita della tesi

1. Introduzione e contesto del problema.
2. Analisi dei requisiti funzionali e non funzionali.
3. Stato dell'arte: CRM, customer journey, funnel e piattaforme analytics.
4. Progettazione architetturale e modello dei dati.
5. Implementazione frontend, backend e database.
6. Sicurezza, multi-tenancy e gestione dei ruoli.
7. Strategia e risultati dei test.
8. Valutazione prestazionale e discussione dei risultati.
9. Limiti, sviluppi futuri e conclusioni.

## 10. Riproducibilità

Le procedure operative aggiornate sono nel README e nella cartella docs. Per ogni prova sperimentale allegare commit di riferimento, configurazione non segreta, versione runtime, dataset sintetico e comando eseguito. Non pubblicare credenziali, dati personali o dump del database aziendale.