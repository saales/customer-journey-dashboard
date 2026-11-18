# Revisione della sicurezza

Data della revisione iniziale: 16 novembre 2026. Aggiornamento delle verifiche: 17 novembre 2026. Ambito: analisi statica del checkout, controlli mirati sulla configurazione di avvio e test disponibili localmente. Non è un penetration test né una certificazione di sicurezza.

## Esito sintetico

Il progetto contiene controlli applicativi e database coerenti con un prototipo B2B multi-tenant: sessioni opache, autorizzazioni sul server, filtri per organizzazione, Row Level Security, ruolo database runtime limitato, migrazioni controllate, rate limiting, controlli dell'origine e token monouso hashati. La revisione ha individuato due punti da correggere prima della distribuzione: il server HTTP si legava a tutte le interfacce di rete per impostazione predefinita e il controllo del database remoto accettava `sslmode=require`, che cifra il traffico ma non garantisce da solo la verifica del nome host. Entrambi sono stati corretti nel checkout di lavoro.

Un ulteriore controllo dei flussi email ha rilevato che i token monouso finivano nella query URL, quindi potevano comparire nei log HTTP del reverse proxy. I nuovi link usano ora il frammento URL, che il browser non invia nelle richieste HTTP; il client elimina il token dalla barra degli indirizzi dopo averlo letto. I link già inviati con token nella query restano compatibili.

La revisione delle credenziali ha inoltre aggiornato scrypt da `N=32768, r=8, p=1` a `N=32768, r=8, p=3`, una delle configurazioni scrypt indicate da OWASP. Gli hash esistenti restano verificabili e vengono aggiornati al nuovo parametro al login riuscito; l'aggiornamento usa un confronto sul vecchio hash per non sovrascrivere un cambio password concorrente. La configurazione va comunque misurata sul server di destinazione sotto carico.

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
- Le password sono trasformate con scrypt `N=32768, r=8, p=3` e salt casuale; il confronto usa una funzione a tempo costante. I vecchi hash `p=1` vengono aggiornati al login riuscito senza invalidare gli account. I token di reset e invito sono monouso, hanno scadenza e sono memorizzati sotto forma di hash.
- I link di invito e reset generati ora trasportano il token nel frammento URL (`#token=` / `#reset=`); il client rimuove il parametro dalla cronologia attuale dopo averlo acquisito e continua ad accettare i link legacy con query.
- Il costo scrypt è stato portato a `N=32768, r=8, p=3`, con verifica retrocompatibile e rehash al successivo login. Riferimento: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Il limitatore di richieste è persistente e usa identificatori derivati con HMAC. I valori configurabili vanno calibrati per il traffico previsto, in particolare quando molti utenti condividono lo stesso indirizzo pubblico.
- Le query applicative usano parametri, includono il contesto dell'organizzazione e sono eseguite in transazioni quando serve impostare la variabile letta dalle policy RLS.
- Il ruolo runtime è separato dal proprietario; il preflight rifiuta attributi elevati, proprietà delle tabelle protette o disattivazione delle policy richieste.
- Le migrazioni sono esplicite, versionate, controllate tramite checksum e advisory lock. Lo startup esegue verifiche in sola lettura e non applica DDL.
- L'esportazione CSV neutralizza le celle che potrebbero essere interpretate come formule dai fogli elettronici.
- `.gitignore` esclude i file di ambiente reali; nel pacchetto deve rimanere solo `.env.example` senza credenziali operative.

## Verifiche eseguite e limiti

La verifica locale precedente resta documentata come tale: in ambiente sandbox alcuni test HTTP non potevano aprire il listener (`EPERM`) e `npm audit` non raggiungeva il registro per un errore DNS. La CI aggiornata del PR [#7](https://github.com/saales/customer-journey-dashboard/pull/7), [run #601](https://github.com/saales/customer-journey-dashboard/actions/runs/44116576426), sul commit `c61e09b665e07ed0c82f9b59561af2497d00cb82`, è passata su Node.js 22 e 24 per installazione, audit (0 vulnerabilità), suite automatizzate, build, migrazioni PostgreSQL, checksum e runtime con ruolo non privilegiato. Su Node.js 22 sono passati anche Playwright/Chromium e i relativi scenari browser.

Neon staging è stato verificato per migrazioni 001–013, checksum, RLS (sei tabelle e sette policy) e ruolo runtime non privilegiato; il servizio Render staging è live e i flussi principali sono stati collaudati manualmente con dati sintetici. La verifica statica dell'interfaccia include skip link, landmark, label, stati accessibili, focus visibile e preferenza reduced-motion, ma non è stato svolto un audit WCAG completo né un test con screen reader. Non sono stati verificati consegna reale delle email, backup e ripristino, carico, penetration test indipendente o ogni combinazione route × tenant. La CI e il collaudo manuale dimostrano soltanto gli scenari effettivamente eseguiti: il progetto non può essere definito privo di falle o pronto per dati aziendali reali sulla sola base di questa revisione.

## Attività prima del rilascio

1. Ripetere la CI e `npm audit` dopo modifiche al codice o al lockfile e conservare il risultato associato al commit.
2. Verificare `HOST`, `NODE_ENV`, `APP_ORIGIN`, TLS del proxy e `DATABASE_URL` nel deployment, senza stampare segreti nei log.
3. Verificare `sslmode=verify-full` contro il provider PostgreSQL scelto e confermare l'esito della validazione del certificato.
4. Eseguire in staging una matrice di test di autorizzazione e isolamento per tutte le API con almeno due tenant sintetici.
5. Verificare backup e ripristino, gestione degli errori, logging, limiti di rate e comportamento dietro proxy.
6. Solo dopo queste prove, decidere se il sistema è adatto al tipo di dati e al carico previsto.


## Aggiornamento accessibilità e operatività — 17 novembre 2026

L'ispezione statica dei componenti principali ha confermato skip link, landmark `aside`/`nav`/`main`, gerarchia di navigazione, `aria-current`, `aria-expanded`, `aria-controls`, label esplicite nei form e messaggi `role=status`/`role=alert`. Sono presenti regole CSS di focus visibile e supporto a `prefers-reduced-motion`. Questo non è un audit WCAG 2.2 AA: non sono stati misurati sistematicamente i contrasti, non è stato eseguito un test completo da tastiera su tutte le schermate né una prova con NVDA/VoiceOver.

Per l'operatività, la copia isolata del branch Neon staging ha mantenuto i conteggi delle 11 tabelle confrontate e lo schema (14 tabelle, 6 con RLS, 7 policy, 13 migrazioni). È una prova di clonazione del branch, non un ripristino da backup logico. Il branch staging non root non consente snapshot manuali; la schedule automatica interrogata risulta vuota. Backup/restore completo resta pertanto aperto.

Le metriche Render disponibili per il periodo 10–17 novembre 2026 non hanno restituito dati di CPU, richieste HTTP o latenza; sono disponibili soltanto due campioni di memoria. Nessuna affermazione di capacità sotto carico è supportata. Non sono state verificate le email reali tramite provider: i test unitari coprono invio simulato, provider disabilitato ed errore HTTP, ma non la consegna effettiva.
