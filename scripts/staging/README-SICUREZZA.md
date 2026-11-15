# Vincoli di sicurezza degli strumenti staging

- Backup: impostare `CONFIRM_DATABASE` e `CONFIRM_HOST` con nome DB e hostname completo (FQDN) verificati nella console del progetto Neon.
- Ripristino: manifest SHA-256 obbligatorio; impostare `CONFIRM_DATABASE` e `CONFIRM_TARGET_HOST`. Il target deve essere vuoto e distinto dall'origine registrata nel manifest.
- Gli script richiedono `sslmode=require` e rifiutano gli endpoint pooler per pg_dump/pg_restore.
- Il nome del database non identifica da solo un progetto Neon: l'hostname completo è parte della conferma.
- I backup contengono dati riservati: conservarli fuori dal repository, con permessi limitati e cifratura a riposo.
- Queste protezioni operative non sostituiscono la verifica manuale della destinazione.
