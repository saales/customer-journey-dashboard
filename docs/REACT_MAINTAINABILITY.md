# Interventi di manutenibilità frontend

## Modifiche incluse

### Caricamento differito delle sezioni

Le sezioni non necessarie alla prima visualizzazione (gestione clienti, importazione, segmentazione, confronti e impostazioni amministrative) sono dichiarate con `React.lazy` e montate sotto `Suspense`.

La dashboard iniziale mantiene i componenti essenziali già importati in modo statico. Il caricamento delle funzionalità secondarie avviene quando la sezione viene effettivamente richiesta. Il fallback espone uno stato `role="status"` e `aria-live="polite"`.

La modifica produce una suddivisione del codice in chunk gestita da Vite. Non viene dichiarata una percentuale di riduzione del bundle: il miglioramento va misurato sul build risultante e confrontato con una baseline riproducibile.

### Organizzazione CSS

Il precedente foglio globale è stato separato in quattro file tematici:

1. `01-foundation.css`: tema, colori e struttura di base.
2. `02-dashboard.css`: schede, KPI, grafici, tabelle e controlli.
3. `03-feature-pages.css`: importazione, funnel, segmentazione e stati delle sezioni.
4. `04-enterprise-overrides.css`: rifiniture responsive e override finali.

`styles.css` resta il punto d'ingresso e importa i quattro file nello stesso ordine in cui le regole comparivano nel foglio precedente. Le dichiarazioni sono state spostate senza riscriverne i selettori o i valori, per limitare il rischio di regressioni visive.

## Verifiche richieste

- `npm ci`
- `npm run build`
- `npm test`
- Verifica browser delle sezioni dashboard, clienti, import, segmentazione, confronti, impostazioni e audit.
- Confronto della dimensione dei chunk prodotti da Vite prima/dopo la modifica.
- Controllo visuale alle viewport 390, 768, 1024 e 1440 px.

La CI della pull request costituisce il gate per test e build. La misura dei chunk non equivale a una misurazione dei tempi percepiti dall'utente; per quest'ultima servono un ambiente comparabile e più esecuzioni.

## Strumenti di lint e formattazione

ESLint e Prettier non sono attivati in questo commit: per inserirli correttamente occorre rigenerare e verificare `package-lock.json` con `npm install --package-lock-only` in un ambiente che raggiunga il registry npm, quindi controllare le nuove dipendenze con `npm audit`. Il lockfile non è stato alterato senza una risoluzione verificabile delle dipendenze.

La configurazione e l'attivazione di ESLint/Prettier restano un follow-up esplicito, non un controllo già superato.
