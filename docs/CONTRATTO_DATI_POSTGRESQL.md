# Contratto dati PostgreSQL — specifica di progettazione

 > **Stato: contratto implementato in parte nel runtime PostgreSQL.** Le migrazioni eseguibili sono versionate in `server/migrations/`; questo documento descrive il modello dati e i vincoli attesi. Non certifica che lo schema remoto Neon sia già stato aggiornato: lo stato va verificato con il preflight read-only.

## Principi di modellazione

- Identificare ogni organizzazione con UUID.
- Ogni dato operativo appartiene a una e una sola organizzazione.
- Le query applicative ricevono l'identificativo dell'organizzazione dal contesto autenticato, non dai parametri controllati dall'utente.
- Le chiavi esterne composite includono `organization_id` quando collegano entità tenant-scoped: un record di un'organizzazione non può riferirsi a un record di un'altra.
- Usare timestamp con timezone (`timestamptz`) per eventi e audit; normalizzare in UTC.
- Usare `BIGINT GENERATED ... AS IDENTITY` per identificativi numerici ad alto volume, ove compatibile con il contratto API.
- Applicare indici che iniziano con `organization_id` per i percorsi di lettura più frequenti.
- Le operazioni che creano/modificano più record devono usare una transazione PostgreSQL.

## Entità previste

| Entità | Dati principali | Vincoli e responsabilità |
|---|---|---|
| organizations | id UUID, name, created_at | Radice del tenant |
| users | id UUID, email normalizzata, password_hash, email_verified_at, last_login_at | Email univoca secondo la policy globale scelta; password hash Argon2id |
| memberships | organization_id, user_id, role, created_at | PK composta; ruoli admin/editor/analyst/viewer |
| invitations | id, organization_id, email, role, token_hash, expires_at, accepted_at | Token mai memorizzato in chiaro; invito limitato al tenant |
| sessions | id, user_id, organization_id, token_hash, expires_at, created_at, last_seen_at | Token casuale lato client, hash lato DB, revoca e scadenza |
| funnel_stages | organization_id, id, label, position, is_active, is_system | PK composta (organization_id, id), posizione univoca per tenant |
| customers | id BIGINT, organization_id, channel, created_at, external_id | Indici tenant-scoped; deduplicazione definita per tenant |
| events | id BIGINT, organization_id, customer_id, stage, occurred_at | FK composita verso customers; indice timeline |
| import_batches | id, organization_id, fingerprint, file_name, row_count, customer_count, imported_at | Fingerprint univoco per tenant, import transazionale |
| audit_logs | id, organization_id, actor_user_id, action, resource_type, resource_id, metadata, created_at | Append-only a livello applicativo; mai registrare segreti o token |

I nomi e i tipi sono una proposta di contratto e devono essere confrontati con la baseline storica prima di essere tradotti in DDL.

## Vincoli relazionali obbligatori

### Appartenenza dei dati

Le tabelle `customers`, `events`, `funnel_stages`, `import_batches` e `audit_logs` devono essere tenant-scoped. La tabella `events` deve avere una chiave esterna composta che referenzi la coppia `(organization_id, customer_id)` di `customers`. La relazione tra sessione, utente e membership deve garantire che l'utente appartenga all'organizzazione della sessione.

### Unicità

- Email utente normalizzata e confrontata in modo case-insensitive secondo una policy esplicita.
- Fingerprint di import univoco all'interno della stessa organizzazione, non necessariamente a livello globale.
- Identificativo esterno cliente univoco per tenant solo se il formato di import lo garantisce; altrimenti usare una chiave di deduplicazione configurabile.
- Posizione delle fasi funnel univoca per organizzazione.

### Indici iniziali da valutare con EXPLAIN

- `customers (organization_id, created_at DESC, id DESC)`
- `customers (organization_id, channel, created_at DESC)`
- `events (organization_id, customer_id, occurred_at, id)`
- `events (organization_id, stage, occurred_at)`
- `funnel_stages (organization_id, position)`
- `sessions (token_hash)` con indice univoco e `sessions (organization_id, user_id, expires_at)`
- `memberships (user_id, organization_id)`
- `invitations (organization_id, token_hash)`

Gli indici definitivi vanno confermati con query reali e piani `EXPLAIN (ANALYZE, BUFFERS)`; non sono una promessa di performance.

## Autorizzazione per ruolo

| Operazione | admin | editor | analyst | viewer |
|---|---:|---:|---:|---:|
| Leggere dashboard e clienti | Sì | Sì | Sì | Sì |
| Creare/modificare clienti ed eventi | Sì | Sì | No | No |
| Importare dati | Sì | Sì | No | No |
| Esportare report | Sì | Sì | Sì | Policy da definire |
| Gestire membri e inviti | Sì | No | No | No |
| Modificare impostazioni tenant | Sì | No | No | No |
| Consultare audit log | Sì | No | No | No |

Questa matrice è il requisito previsto; ogni route deve verificarlo sul server. Nascondere controlli nell'interfaccia non è un controllo di sicurezza.

## Test d'isolamento richiesti

1. Creare tenant A e tenant B con utenti distinti.
2. Inserire cliente ed eventi in entrambi i tenant con ID volutamente noti al test.
3. Autenticarsi come utente A e tentare GET, PUT, DELETE e import/export usando ID appartenenti a B.
4. Verificare che le risposte non rivelino dati di B e che nessuna riga di B venga modificata.
5. Ripetere i test per tutte le route analitiche, paginazione, conteggi, filtri, CSV e gestione funnel.
6. Tentare una relazione evento-cliente cross-tenant direttamente nel database e verificare il rifiuto della FK.
7. Verificare logout, revoca sessione, scadenza, cambio password e rimozione membership.
8. Verificare che le transazioni d'import siano rollbackate integralmente in caso di errore.

## Migrazione e compatibilità

- Non alterare file di migrazione già applicati.
- Non eseguire DDL su Neon da CI.
- Testare le migrazioni su PostgreSQL usa-e-getta e su una copia ripristinata del database.
- Prima del rilascio, confrontare conteggi, vincoli e risultati analitici sul database PostgreSQL di staging e sul dataset di riferimento.
- Mantenere un piano di rollback che non richieda downgrade distruttivi dello schema.
- Non eseguire seed automatico in produzione; ogni nuova organizzazione deve essere vuota.


## Implementazione introdotta nel branch

Le migrazioni `003`–`007` aggiungono hardening tenant, limiti ai tentativi di accesso, privilegi minimi del ruolo applicativo, timeout di inattività sessione e gestione delle membership. I record clienti legacy ricevono un valore tecnico `legacy:<id>`: non è il recupero di un identificativo esterno originario. Il contesto RLS è `app.current_organization_id` e viene impostato nella stessa transazione delle query. Il ruolo runtime, il middleware di autenticazione/autorizzazione e i repository tenant-scoped sono presenti nel ramo; le verifiche sul database remoto e i test browser end-to-end restano da completare.
