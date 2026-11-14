# Inizializzazione della prima organizzazione PostgreSQL

Questa procedura crea il primo tenant, il suo amministratore e le cinque fasi iniziali del funnel. È un'operazione amministrativa una tantum, non una registrazione pubblica.

## Prerequisiti

1. Database PostgreSQL dedicato e verificato.
2. Migrazioni versionate già applicate e controllate con `npm run db:migrate -w server -- --check`.
3. Connessione amministrativa separata dal ruolo HTTP, con privilegi di proprietario dello schema.
4. Ruolo runtime `percorso_app` creato e configurato secondo la guida di distribuzione.
5. Password iniziale di almeno 12 caratteri, custodita in un gestore credenziali.

Il comando non usa `DATABASE_URL`: richiede `BOOTSTRAP_DATABASE_URL` dedicata. Non usare la connessione del server HTTP.

## Configurazione

Impostare le seguenti variabili nell'ambiente protetto o in un file locale escluso dal versionamento:

```dotenv
BOOTSTRAP_DATABASE_URL=postgresql://...
BOOTSTRAP_CONFIRM_DATABASE=nome_esatto_database
BOOTSTRAP_ORGANIZATION_NAME=Nome organizzazione
BOOTSTRAP_ORGANIZATION_SLUG=nome-organizzazione
BOOTSTRAP_ADMIN_EMAIL=amministratore@example.com
BOOTSTRAP_ADMIN_NAME=Nome Cognome
BOOTSTRAP_ADMIN_PASSWORD=una-password-lunga-e-casuale
```

Non inserire password o URL reali in file versionati, ticket, log o cronologia della shell.

## Esecuzione esplicita

Dalla cartella principale:

```bash
npm run db:bootstrap -w server -- --confirm-empty-database
```

Il flag è obbligatorio. Il comando confronta il nome del database con `BOOTSTRAP_CONFIRM_DATABASE`, acquisisce un lock transazionale e rifiuta l'operazione se esiste già almeno un'organizzazione o un utente. Organizzazione, utente amministratore, membership, fasi funnel e audit event sono creati in un'unica transazione. In caso di errore viene eseguito il rollback.

La password viene derivata con scrypt e non è stampata. Il codice organizzazione da inserire nel modulo di accesso è lo slug configurato.

## Dopo il bootstrap

- Rimuovere le variabili di bootstrap dall'ambiente.
- Ruotare o revocare la credenziale amministrativa temporanea secondo la policy del provider.
- Configurare il runtime HTTP con la sola connessione del ruolo `percorso_app`.
- Verificare il preflight del runtime e provare login, logout, permessi e accesso tenant-scoped.
- Conservare la password iniziale in un gestore credenziali e consegnarla all'amministratore tramite un canale sicuro.

## Limiti

Il bootstrap iniziale crea esclusivamente la prima organizzazione e il primo amministratore in un database vuoto. Non invita altri utenti e non trasferisce dataset preesistenti. Non modifica automaticamente database remoti: agisce soltanto sull'endpoint esplicitamente configurato. I test automatici verificano creazione, hashing password e rollback su PostgreSQL temporaneo. Prima di un rilascio reale, ripetere la procedura in staging isolato.