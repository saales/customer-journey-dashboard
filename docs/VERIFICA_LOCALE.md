# Verifica locale del progetto

Data: 16 novembre 2026. Questi risultati descrivono il checkout di lavoro revisionato in questa data; non attestano un rilascio in produzione.

## Ambiente

- L'ambiente di lavoro usa Node.js 26.13.1 e npm 11.20.0.
- Le prove automatizzate precedenti erano state eseguite con PostgreSQL 16.16 temporaneo, poi rimosso.
- La pipeline GitHub Actions del PR [#7](https://github.com/saales/customer-journey-dashboard/pull/7), run [43869048649](https://github.com/saales/customer-journey-dashboard/actions/runs/43869048649), sul commit `c53715f70ac9afbdc1cbef88cdcb873330be254c`, è passata su Node.js 20 e 22. Installazione, `npm audit`, suite automatizzate, build, controlli delle migrazioni e runtime con privilegi ridotti hanno avuto esito positivo in entrambe le versioni. Su Node.js 22 sono passati anche Playwright/Chromium e gli scenari browser, incluso un test con un secondo tenant.

## Prove sul checkout revisionato

- `npm run build`: compilazione TypeScript del server e build Vite completate. Vite segnala un bundle JavaScript principale di circa 690 kB, sopra la soglia di avviso di 500 kB.
- I 3 test mirati di `assertSecurePostgresTransport` sono passati: verificano il rifiuto delle URL remote senza `sslmode=verify-full`, l'accettazione delle URL locali e il rifiuto di parametri TLS duplicati.
- Dopo gli aggiornamenti di sicurezza, la suite client ha completato 71 test e 5 file server mirati hanno completato 25 test.
- Il test locale isolato di scrypt `N=32768, r=8, p=3` ha impiegato circa 206 ms con Node.js 26.13.1; non sostituisce la misura sul server previsto per il rilascio.
- `env -u DATABASE_URL npm test`: 130 test server passati, 321 saltati perché PostgreSQL non era configurato e 11 test HTTP non completati perché il sandbox rifiuta l'apertura del listener locale con `EPERM`. Il comando complessivo termina con errore per questo limite; non è una suite completamente verde. La CI precedente aveva eseguito i test HTTP e d'integrazione prima delle modifiche più recenti.
- `npm audit --omit=dev` locale non ha potuto raggiungere `registry.npmjs.org` (`getaddrinfo ENOTFOUND`). La CI precedente ha completato con esito positivo `npm audit`; va ripetuto sul nuovo commit.
- La suite browser è passata su Node.js 22 nella CI, non in locale.

## Limiti delle prove

Il database remoto, la consegna effettiva delle email, staging, backup e ripristino, carico, accessibilità con tecnologie assistive e l'intera matrice di isolamento tra organizzazioni non sono stati collaudati in questa revisione. La suite contiene test cross-tenant per API e tabelle selezionate; la matrice non sostituisce una verifica sul provider e sull'ambiente effettivi. Prima di riportare nuove misure nella tesi, ripetere i test con ambiente, commit, dataset sintetico, comandi e risultati salvati.


## Evidenze staging — 17 novembre 2026

- Neon staging: 14 tabelle, 6 tabelle RLS, 7 policy, 13 migrazioni.
- È stato creato il branch temporaneo `staging-restore-drill-2026-11-17` come copia del branch `staging-pre-release`; i conteggi di organizzazioni, utenti, membership, clienti, eventi, fasi, inviti, sessioni, audit, import e migrazioni coincidono. La copia scade il 19 novembre 2026 alle 16:00 UTC. Questa è una prova di clonazione, non di restore da dump.
- La schedule snapshot per il branch staging è vuota e Neon rifiuta snapshot manuali su branch secondari. Backup logico e point-in-time restore non sono ancora collaudati.
- Render staging è sul piano Free con una istanza. Per 10–17 novembre le serie CPU, richieste HTTP e latenza erano vuote; due soli campioni di memoria erano disponibili. Non esiste una misura attendibile di performance sotto carico.
- Accessibilità: revisione statica di landmark, skip link, label, stati ARIA, focus e reduced motion. Non è un audit WCAG e non sostituisce test con screen reader e contrast checker.
- Email: i test unitari del provider sono presenti; non è stata eseguita una consegna reale da staging.

Prima di dichiarare completati questi gate occorrono un backup logico verificato e restore in ambiente isolato, un test di carico controllato con dataset rappresentativo, un audit WCAG assistito da strumenti e tecnologie assistive e una email di prova autorizzata con conferma della consegna.
