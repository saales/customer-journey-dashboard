# Gate di rilascio — criteri obbligatori

Questo documento definisce le condizioni da soddisfare prima di promuovere Percorso Cliente a produzione o usarlo con dati aziendali reali. Una casella può essere marcata completata solo con evidenza verificabile (log CI, report, checksum, screenshot o verbale).

## A. Codice e qualità

- [ ] Revisione di tutte le modifiche incluse nella release e approvazione PR.
- [ ] CI verde su Node.js 20 e 22 sul commit esatto candidato al rilascio.
- [ ] Test unitari e d'integrazione PostgreSQL superati.
- [ ] Build server e client superata.
- [ ] E2E browser superati per tutti i ruoli previsti.
- [ ] Nessun errore critico/alto irrisolto nell'audit dipendenze e nella revisione sicurezza.
- [ ] Test di regressione per gestione sessioni, inviti, recupero password, import/export e audit.

## B. Isolamento e autorizzazioni

- [ ] Matrice ruoli/permessi verificata per ogni endpoint protetto.
- [ ] Test negativi cross-tenant per lettura, creazione, modifica, cancellazione, export e azioni amministrative.
- [ ] Verifica RLS su tutte le tabelle tenant: RLS abilitata, policy attese presenti e predicati USING/WITH CHECK coerenti.
- [ ] Ruolo runtime non proprietario, NOINHERIT, senza SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE e senza privilegi distruttivi non necessari.
- [ ] Sessioni: scadenza, revoca, logout, rotazione e cambio password verificati.
- [ ] Nessun dato sensibile nei log o nelle risposte d'errore.

## C. Database e recupero

- [ ] Identità host/database/ruolo verificata prima di ogni operazione.
- [ ] Migrazioni applicate con ruolo amministrativo dedicato e checksum coerenti.
- [ ] Verificatore read-only eseguito con il ruolo runtime sul database staging.
- [ ] Backup completo creato, checksum controllato e manifest archiviato.
- [ ] Restore su database isolato completato e smoke test superato.
- [ ] RPO/RTO definiti e prova di ripristino documentata.
- [ ] Procedura di cancellazione tenant testata solo su fixture/database sacrificabile, con doppia conferma e ricevuta.

## D. Esercizio e infrastruttura

- [ ] Ambiente staging separato da produzione.
- [ ] Dominio, HTTPS, cookie Secure, CORS/Origin e reverse proxy verificati.
- [ ] Segreti in secret manager, non in repository o immagini.
- [ ] Email transazionali testate (invito e recupero password) con mittente verificato.
- [ ] Health check, log strutturati, allarmi, monitoraggio e rotazione log configurati.
- [ ] Rate limiting e pulizia periodica verificati.
- [ ] Test di carico e limiti connessioni PostgreSQL verificati.
- [ ] Piano di rollback e contatti operativi documentati.

## E. Prontezza commerciale e privacy

- [ ] Informativa privacy, registro trattamenti e ruoli titolare/responsabile valutati con consulente competente.
- [ ] DPA/accordo sul trattamento, condizioni di servizio e SLA predisposti.
- [ ] Conservazione, esportazione e cancellazione dei dati cliente documentate.
- [ ] Processo di onboarding, supporto, gestione incidenti e richieste privacy definito.
- [ ] Prezzi, limiti di piano, fatturazione e gestione rinnovi definiti.
- [ ] Demo con dati sintetici separata da ogni ambiente con dati reali.

## Regola di promozione

Non promuovere se una voce di sicurezza, isolamento tenant, backup/restore o privacy è aperta. Un test verde su PostgreSQL temporaneo non dimostra che il database remoto sia stato migrato o che il servizio sia pronto per il carico e i dati dei clienti.
