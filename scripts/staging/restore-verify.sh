#!/usr/bin/env bash
# Ripristina un backup in un database/branch DI DESTINAZIONE VUOTO e ne verifica l'integrità.
#
#   BACKUP_FILE=./backups/<file>.dump
#   TARGET_DATABASE_URL=postgresql://...   (database di prova vuoto, endpoint diretto)
#   CONFIRM_DATABASE=<nome del database di destinazione>
#   SOURCE_DATABASE_URL=...                (opzionale: confronta i conteggi con l'origine; solo staging/dati sintetici)
#
# Rifiuta di scrivere se: la destinazione contiene già tabelle, coincide con l'origine, il checksum
# del file non corrisponde al manifest, oppure il ruolo applicativo non esiste nella destinazione.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_cmd pg_restore; require_cmd psql; require_cmd sha256sum; require_cmd node

[ -f "${BACKUP_FILE:-}" ] || die "BACKUP_FILE non trovato."
[ -n "${TARGET_DATABASE_URL:-}" ] || die "impostare TARGET_DATABASE_URL."
RUNTIME_ROLE="${RUNTIME_ROLE:-percorso_app}"

# 1) Integrità del file rispetto al manifest.
if [ -f "$BACKUP_FILE.manifest.json" ]; then
  EXPECTED="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sha256)' "$BACKUP_FILE.manifest.json")"
  ACTUAL="$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)"
  [ "$EXPECTED" = "$ACTUAL" ] || die "checksum del backup diverso dal manifest: file alterato o corrotto."
  echo "Checksum backup verificato."
else
  echo "ATTENZIONE: manifest assente, checksum non verificabile." >&2
fi

# 2) Destinazione: identità, distinta dall'origine, vuota.
load_pg_env "$TARGET_DATABASE_URL"
confirm_database "${CONFIRM_DATABASE:-}"
TARGET_ID="$PGHOST:$PGPORT/$PGDATABASE"
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  ( load_pg_env "$SOURCE_DATABASE_URL"; [ "$PGHOST:$PGPORT/$PGDATABASE" != "$TARGET_ID" ] ) || die "origine e destinazione coincidono: ripristino rifiutato."
fi
echo "Destinazione: $(describe_target)"
TABLES="$(psql -Atc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")"
[ "$TABLES" = "0" ] || die "la destinazione contiene già $TABLES tabelle: usare un database/branch vuoto."
psql -Atc "SELECT 1 FROM pg_roles WHERE rolname='$RUNTIME_ROLE'" | grep -q 1 \
  || die "il ruolo '$RUNTIME_ROLE' non esiste nella destinazione: crearlo (NOINHERIT, senza privilegi elevati) oppure ripristinare in un branch che lo contenga."

# 3) Ripristino (si ferma al primo errore).
pg_restore --exit-on-error --no-owner --dbname "$PGDATABASE" "$BACKUP_FILE"
echo "Ripristino eseguito."

# 4) Verifiche strutturali.
psql -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'migrazioni registrate: ' || COUNT(*) FROM public.schema_migrations;
SELECT 'tabelle con RLS attiva: ' || COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
SELECT 'policy RLS: ' || COUNT(*) FROM pg_policies WHERE schemaname='public';
SQL

# 5) Confronto conteggi con l'origine (opzionale; legge solo conteggi aggregati).
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  COUNT_SQL="SELECT 'organizations', COUNT(*) FROM organizations UNION ALL SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'memberships', COUNT(*) FROM memberships UNION ALL SELECT 'customers', COUNT(*) FROM customers UNION ALL SELECT 'events', COUNT(*) FROM events UNION ALL SELECT 'funnel_stages', COUNT(*) FROM funnel_stages UNION ALL SELECT 'import_batches', COUNT(*) FROM import_batches UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs UNION ALL SELECT 'invitations', COUNT(*) FROM invitations ORDER BY 1"
  TARGET_COUNTS="$(psql -At -c "$COUNT_SQL")"
  SOURCE_COUNTS="$( load_pg_env "$SOURCE_DATABASE_URL"; psql -At -c "$COUNT_SQL")"
  if [ "$TARGET_COUNTS" = "$SOURCE_COUNTS" ]; then echo "Conteggi identici all'origine:"; echo "$TARGET_COUNTS"
  else echo "DIFFERENZE nei conteggi (l'origine può essere cambiata dopo il backup):" >&2; diff <(echo "$SOURCE_COUNTS") <(echo "$TARGET_COUNTS") >&2 || true; exit 3; fi
fi
echo
echo "Ora eseguire, con il ruolo runtime sulla destinazione:"
echo "  npm run db:verify-readonly -- --expect-database $PGDATABASE"
echo "  npm run db:migrate -- --check"
