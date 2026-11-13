# Decisione tecnica — PostgreSQL-first per il SaaS B2B

## Decisione

PostgreSQL è il solo database target del prodotto. Non si sviluppano nuove funzionalità applicative su SQLite e non si mantiene una doppia implementazione come architettura finale. Il runtime Express resta temporaneamente legacy finché il backend PostgreSQL non copre le funzionalità e supera i test di sicurezza e parità.

La sostituzione del runtime avverrà per moduli, con interfacce repository asincrone e test PostgreSQL. Non è un cambio meccanico da `better-sqlite3` a `pg`: transazioni, query sincrone, tipi, paginazione e import hanno contratti differenti.

## Strategia schema

- Conservare gli SQL 001 e 002 e i loro checksum: sono storia versionata e non vanno riscritti.
- Usare migrazioni additive per correggere il modello dati e rendere verificabile l'upgrade.
- La migrazione 003 aggiunge `customers.external_id`, assegna ai record preesistenti un identificativo tecnico `legacy:<id>`, introduce il vincolo sessione/membership come FK `NOT VALID` e abilita RLS sulle tabelle operative tenant-scoped.
- L'identificativo `legacy:<id>` non ricostruisce un external ID originario: è un valore tecnico di compatibilità. I nuovi import devono salvare l'identificativo esterno reale secondo una policy tenant-scoped.
- RLS usa `app.current_organization_id`; ogni operazione applicativa deve impostare il contesto nella stessa transazione e mantenere filtri SQL espliciti per `organization_id`.
- Il ruolo runtime PostgreSQL non deve essere proprietario delle tabelle, superuser o avere `BYPASSRLS`. RLS non sostituisce l'autorizzazione applicativa.

## Nuovo ambiente e dati esistenti

Un database nuovo e isolato è la destinazione preferita per il primo staging PostgreSQL, perché permette di validare la baseline senza toccare il database condiviso. Non si presume però che Neon sia vuoto o contenga soltanto dati demo.

Prima di decidere se ricreare o trasferire dati:
1. verificare con il proprietario del prodotto se Neon contiene dati reali di clienti;
2. ispezionare in sola lettura storico migrazioni, checksum, schema, ruoli e policy del database corretto;
3. produrre backup e prova di restore prima di qualunque intervento autorizzato;
4. classificare i dati da conservare, trasformare o scartare;
5. provare la migrazione su un database isolato e confrontare conteggi e risultati.

Nessuna migrazione qui descritta è stata applicata a Neon. Il runner automatico non va eseguito su un database condiviso come scorciatoia di ricostruzione.

## Sequenza di implementazione

1. Schema PostgreSQL e test d'integrazione su PostgreSQL effimero.
2. Repository asincroni per clienti, eventi, funnel, analytics, import ed export.
3. Login completo, sessioni server-side, membership e autorizzazione per ruolo.
4. Middleware Express che deriva il tenant dalla sessione verificata.
5. Test API cross-tenant per letture, scritture, import, export, conteggi e paginazione.
6. Cutover su staging nuovo, backup/restore, smoke test e confronto risultati.
7. Dismissione del runtime SQLite solo dopo il superamento dei criteri di accettazione.

## Criteri di uscita

- Tutte le route applicative usano PostgreSQL e un contesto tenant autenticato.
- Il runtime non accetta `organization_id` come autorità dal body o dalla query string.
- Il ruolo runtime è separato dal proprietario schema e non bypassa RLS.
- Test di isolamento negativi e test di autorizzazione per ogni ruolo passano.
- Import/export sono transazionali, idempotenti dove richiesto e tenant-scoped.
- CI verifica installazione, test e build su Node supportati e PostgreSQL.
- Staging è ripristinabile da backup e il rollback è documentato.
- Seed demo disabilitato in produzione e nessun dato demo assegnato a tenant reali.

## Stato al checkpoint

La migrazione 003 e il relativo test d'integrazione sono stati aggiunti al branch di lavoro. Il runtime Express usa ancora SQLite; il resolver sessioni e il repository clienti PostgreSQL non sono ancora collegati alle route. Nessuna modifica a `main` o al database Neon.
