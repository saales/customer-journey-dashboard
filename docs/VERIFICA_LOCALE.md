# Verifica locale del progetto

Data: 16 novembre 2026. Questi risultati descrivono il checkout di lavoro revisionato in questa data; non attestano un rilascio in produzione.

## Ambiente e prove precedenti

- L'ambiente di lavoro usa Node.js 26.13.1 e npm 11.20.0.
- Le prove automatizzate precedenti erano state eseguite con PostgreSQL 16.16 temporaneo, poi rimosso.
- La pipeline GitHub Actions del PR [#7](https://github.com/saales/customer-journey-dashboard/pull/7), run [43853192901](https://github.com/saales/customer-journey-dashboard/actions/runs/43853192901), era passata su Node.js 20 e 22; su Node.js 22 erano passati anche Playwright/Chromium e gli scenari browser. Questa esecuzione precede le ultime modifiche al bind HTTP e ai requisiti TLS e non sostituisce una nuova esecuzione sul commit aggiornato.

## Prove sul checkout revisionato

- `npm run build`: compilazione TypeScript del server e build Vite completate. Vite segnala un bundle JavaScript principale di circa 690 kB, sopra la soglia di avviso di 500 kB.
- I 3 test mirati di `assertSecurePostgresTransport` sono passati: verificano il rifiuto delle URL remote senza `sslmode=verify-full`, l'accettazione delle URL locali e il rifiuto di parametri TLS duplicati.
- La suite client ha completato 70 test.
- La suite server non è stata completata in questo ambiente: il sandbox rifiuta l'apertura dei listener HTTP con `EPERM`. I test che dipendono da HTTP vanno rieseguiti in un ambiente che consenta socket locali; i timeout osservati non sono stati classificati come difetti applicativi né come esiti positivi.
- `npm audit` non ha potuto raggiungere `registry.npmjs.org` (`getaddrinfo ENOTFOUND`). Non è quindi disponibile un controllo aggiornato delle vulnerabilità dei pacchetti in questo ambiente.
- La suite browser non è stata rieseguita dopo le modifiche più recenti.

## Limiti delle prove

Il database remoto, la consegna effettiva delle email, staging, backup e ripristino, carico, accessibilità con tecnologie assistive e l'intera matrice di isolamento tra organizzazioni non sono stati collaudati in questa revisione. La CI precedente copriva alcuni casi cross-tenant, non tutte le API. Prima di riportare misure nella tesi, ripetere i test con ambiente, commit, dataset sintetico, comandi e risultati salvati.
