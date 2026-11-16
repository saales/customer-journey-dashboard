# Revisione della sicurezza

Data della revisione: 16 novembre 2026. Ambito: analisi statica del checkout, controlli mirati sulla configurazione di avvio e test disponibili localmente. Non è un penetration test né una certificazione di sicurezza.

## Esito sintetico

Il progetto contiene controlli applicativi e database coerenti con un prototipo B2B multi-tenant: sessioni opache, autorizzazioni sul server, filtri per organizzazione, Row Level Security, ruolo database runtime limitato, migrazioni controllate, rate limiting, controlli dell'origine e token monouso hashati. La revisione ha individuato due punti da correggere prima della distribuzione: il server HTTP si legava a tutte le interfacce di rete per impostazione predefinita e il controllo del database remoto accettava `sslmode=require`, che cifra il traffico ma non garantisce da solo la verifica del nome host. Entrambi sono stati corretti nel checkout di lavoro.

## Modifiche applicate

### Listener HTTP

`server/src/postgres-server.ts` ora ascolta su `127.0.0.1` se `HOST` non è configurato. Su un host singolo, il reverse proxy locale resta l'unico ingresso di rete. Se il proxy è in un container o su un host diverso, `HOST` deve indicare un'interfaccia privata raggiungibile solo dal proxy; la porta Node non deve essere pubblicata direttamente su Internet.

### Collegamento al database remoto

In produzione, `server/src/postgres-transport-config.ts` accetta per i database remoti una sola modalità `sslmode=verify-full`. Il driver deve negoziare TLS e verificare la catena del certificato e il nome dell'host. `require` e `verify-ca` sono rifiutati: `require` non autentica necessariamente il server e `verify-ca` non verifica sempre il nome host. Gli indirizzi locali sono ammessi per lo sviluppo e il test. La configurazione effettiva del servizio e del provider va comunque verificata durante il collaudo.

## Controlli presenti nel codice

- Le origini web sono configurate con una allowlist esatta; in produzione sono richieste origini HTTPS. Le richieste che modificano dati controllano l'header `Origin`.
- Il server imposta intestazioni HTTP di protezione; la Content Security Policy è nel file Nginx di esempio e va applicata anche se si usa un reverse proxy diverso.
- Le API protette richiedono sessione e autorizzazione server-side. Il ruolo dell'utente determina i permessi; nascondere una funzione nell'interfaccia non è sufficiente.
- Le sessioni usano token casuali da 256 bit, conservati nel database come hash, cookie `HttpOnly` e `SameSite=Strict`; in produzione il cookie usa il prefisso `__Host-` e l'attributo `Secure`.
- Le password sono trasformate con scrypt e salt casuale; il confronto usa una funzione a tempo costante. I token di reset e invito sono monouso, hanno scadenza e sono memorizzati sotto forma di hash.
- Il limitatore di richieste è persistente e usa identificatori derivati con HMAC. I valori configurabili vanno calibrati per il traffico previsto, in particolare quando molti utenti condividono lo stesso indirizzo pubblico.
- Le query applicative usano parametri, includono il contesto dell'organizzazione e sono eseguite in transazioni quando serve impostare la variabile letta dalle policy RLS.
- Il ruolo runtime è separato dal proprietario; il preflight rifiuta attributi elevati, proprietà delle tabelle protette o disattivazione delle policy richieste.
- Le migrazioni sono esplicite, versionate, controllate tramite checksum e advisory lock. Lo startup esegue verifiche in sola lettura e non applica DDL.
- L'esportazione CSV neutralizza le celle che potrebbero essere interpretate come formule dai fogli elettronici.
- `.gitignore` esclude i file di ambiente reali; nel pacchetto deve rimanere solo `.env.example` senza credenziali operative.

## Verifiche eseguite e limiti

Sul checkout revisionato sono stati eseguiti la build del server e del client e i test mirati sul requisito `sslmode=verify-full`. La suite client ha completato 70 test. La suite server e le prove browser non sono state completate dopo le modifiche: il sandbox locale rifiuta l'apertura di listener HTTP (`EPERM`) e `npm audit` non ha raggiunto il registro dei pacchetti per un errore DNS. Una run CI precedente era passata prima delle ultime modifiche; occorre eseguire nuovamente la CI sul commit aggiornato.

Non sono stati verificati un database remoto, un deploy su staging, la consegna reale delle email, backup e ripristino, carico, accessibilità o ogni combinazione di endpoint e tenant. La copertura esistente dimostra alcuni scenari cross-tenant, ma non l'intera matrice. Per questo il progetto non può essere definito privo di falle o pronto per dati aziendali reali sulla sola base di questa revisione.

## Attività prima del rilascio

1. Eseguire la CI completa sul commit aggiornato e ripetere `npm audit` da una rete disponibile.
2. Verificare `HOST`, `NODE_ENV`, `APP_ORIGIN`, TLS del proxy e `DATABASE_URL` nel deployment, senza stampare segreti nei log.
3. Verificare `sslmode=verify-full` contro il provider PostgreSQL scelto e confermare l'esito della validazione del certificato.
4. Eseguire in staging una matrice di test di autorizzazione e isolamento per tutte le API con almeno due tenant sintetici.
5. Verificare backup e ripristino, gestione degli errori, logging, limiti di rate e comportamento dietro proxy.
6. Solo dopo queste prove, decidere se il sistema è adatto al tipo di dati e al carico previsto.
