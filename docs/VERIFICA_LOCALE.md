# Verifica locale del progetto

Data: 16 novembre 2026

## Ambiente

- Node.js 26.13.1 e npm 11.20.0.
- PostgreSQL 16.16 locale; i test d'integrazione sono stati eseguiti su un database temporaneo dedicato, poi rimosso.

## Risultati

- `npm ci`: completato; 382 pacchetti installati, audit senza vulnerabilità note.
- `npm test`: 452 test server e 70 test client superati. Le prove PostgreSQL e HTTP sono state eseguite contro il database temporaneo locale.
- `npm run build`: compilazione TypeScript e build Vite completate.
- `npm audit`: zero vulnerabilità rilevate.
- `npm run test:e2e`: non eseguito in locale; il flusso browser viene predisposto nella CI con Chromium e dati sintetici.

La build segnala un bundle JavaScript principale di circa 690 kB non compresso, sopra la soglia di avviso Vite di 500 kB. La compilazione riesce; per ridurre il tempo di caricamento iniziale si può valutare lo spezzamento del bundle.

## Verifiche ancora necessarie

Queste prove non verificano il database remoto, la consegna reale delle email, un ambiente staging, il ripristino di backup, le prestazioni sotto carico o l'accessibilità con tecnologie assistive. Per la tesi, le misure sperimentali vanno raccolte separatamente e riportate con ambiente, dataset e metodo riproducibili.
