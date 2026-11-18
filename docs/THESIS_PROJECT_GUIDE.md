# Guida tecnica per la tesi — Percorso Cliente

> Documento di lavoro: descrive l'implementazione presente nel repository. Le valutazioni sperimentali, i risultati prestazionali e lo stato degli ambienti remoti devono essere completati con misurazioni riproducibili; non vanno presentati come già verificati. La guida distingue le verifiche automatiche, i controlli manuali e le attività ancora aperte al 18 novembre 2026.

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
- **Test e integrazione continua:** Vitest, Testing Library, PostgreSQL temporaneo e GitHub Actions su Node.js 22 e 24. La pipeline esegue Playwright/Chromium sul job Node.js 22; entrambi i job verificano test, build, migrazioni e runtime con ruolo limitato.

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

La pipeline automatizzata comprende test frontend e backend, build TypeScript, migrazioni 001–013 su PostgreSQL temporaneo, controllo dello storico/checksum e avvio del server con un ruolo non privilegiato. Su Node.js 22 include un percorso browser Playwright/Chromium con admin, editor, analyst e viewer, oltre a flussi di clienti, funnel, import/export CSV, inviti, audit e permessi. Un secondo tenant sintetico consente di verificare alcuni casi di accesso incrociato via API; non è una dimostrazione esaustiva dell'isolamento per ogni endpoint.

**Evidenze già raccolte al 18 novembre 2026:** CI verde sul commit `69d14d9` per Node.js 22 e 24; test browser Playwright superati su Node.js 22; migrazioni PostgreSQL 001–013, checksum e avvio con ruolo runtime limitato superati. I principali flussi dell'interfaccia sono stati verificati manualmente su staging con dati sintetici. Il backup logico dello staging è stato ripristinato con successo su PostgreSQL 18.7 locale isolato: 14 tabelle, con conteggi controllati per cinque tabelle applicative. Sono stati eseguiti controlli manuali da tastiera su login e dashboard; la verifica delle altre schermate è in corso. L'invio reale di email non è stato provato perché non è disponibile un dominio mittente verificato. Non sono disponibili misure affidabili di carico, throughput o p95/p99.

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

Tra le attività da chiudere prima di un rilascio aziendale rientrano la pianificazione e la verifica periodica dei backup, una prova di ripristino su un ambiente remoto isolato, l'estensione dei casi cross-tenant, test di carico e monitoraggio, un audit completo di accessibilità e sicurezza e la verifica della consegna email. Il recupero password e l'invio email tramite Resend sono implementati nel codice; la consegna reale delle email richiede un dominio mittente verificato e non è stata verificata in questa attività.

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
