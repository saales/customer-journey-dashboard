# Verifica locale del progetto

Data: 16 novembre 2026. Questi risultati descrivono il checkout di lavoro revisionato in questa data; non attestano un rilascio in produzione.

## Ambiente

- L'ambiente di lavoro usa Node.js 26.13.1 e npm 11.20.0.
- Le prove automatizzate precedenti erano state eseguite con PostgreSQL 16.16 temporaneo, poi rimosso.
- La pipeline GitHub Actions del PR [#7](https://github.com/saales/customer-journey-dashboard/pull/7), run [43869048649](https://github.com/saales/customer-journey-dashboard/actions/runs/43869048649), sul commit `c53715f70ac9afbdc1cbef88cdcb873330be254c`, è passata su Node.js 20 e 22. Installazione, `npm audit`, suite automatizzate, build, controlli delle migrazioni e runtime con privilegi ridotti hanno avuto esito positivo in entrambe le versioni. Su Node.js 22 sono passati anche Playwright/Chromium e gli scenari browser, incluso un test con un secondo tenant.

## Prove sul checkout revisionato

- `npm run build`: compilazione TypeScript del server e build Vite completate. Vite segnala un bundle JavaScript principale di circa 690 kB, sopra la soglia di avviso di 500 kB.
- I 3 test mirati di `assertSecurePostgresTransport` sono passati: verificano il rifiuto delle URL remote senza `sslmode=verify-full`, l'accettazione delle URL locali e il rifiuto di parametri TLS duplicati.
- La suite client ha completato 70 test.
- La suite server non è stata completata in locale: il sandbox rifiuta l'apertura dei listener HTTP con `EPERM`. I relativi controlli sono stati eseguiti con esito positivo nella CI indicata sopra.
- `npm audit` locale non ha potuto raggiungere `registry.npmjs.org` (`getaddrinfo ENOTFOUND`); il controllo aggiornato è stato completato con esito positivo nella CI.
- La suite browser è passata su Node.js 22 nella CI, non in locale.

## Limiti delle prove

Il database remoto, la consegna effettiva delle email, staging, backup e ripristino, carico, accessibilità con tecnologie assistive e l'intera matrice di isolamento tra organizzazioni non sono stati collaudati in questa revisione. La CI copre alcuni casi cross-tenant, non tutte le API. Prima di riportare nuove misure nella tesi, ripetere i test con ambiente, commit, dataset sintetico, comandi e risultati salvati.
