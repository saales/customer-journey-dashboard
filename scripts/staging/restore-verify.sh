#!/usr/bin/env bash
# Ripristino solo su database staging vuoto, verificato e distinto dall'origine.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_cmd pg_restore; require_cmd psql; require_cmd sha256sum; require_cmd node
[ -f "${BACKUP_FILE:-}" ] || die "BACKUP_FILE non trovato."
[ -f "$BACKUP_FILE.manifest.json" ] || die "manifest SHA-256 obbligatorio: ripristino bloccato."
[ -n "${TARGET_DATABASE_URL:-}" ] || die "impostare TARGET_DATABASE_URL."
RUNTIME_ROLE="${RUNTIME_ROLE:-percorso_app}"
EXPECTED="$(node -e 'const m=require(require("node:path").resolve(process.argv[1])); if(!m.sha256||!m.sourceHost||!m.sourceDatabase) process.exit(2); console.log(m.sha256)' "$BACKUP_FILE.manifest.json")" || die "manifest non valido."
ACTUAL="$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)"
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum non corrispondente."
load_pg_env "$TARGET_DATABASE_URL"
confirm_database "${CONFIRM_DATABASE:-}"
confirm_host "${CONFIRM_TARGET_HOST:-}"
require_tls
case "$PGHOST" in *-pooler.*) die "usare endpoint diretto per il ripristino." ;; esac
TARGET_ID="$(target_identity)"
SOURCE_ID="$(node -e 'const m=require(process.argv[1]); console.log(String(m.sourceHost).toLowerCase()+":"+String(m.sourcePort||5432)+"/"+m.sourceDatabase)' "$BACKUP_FILE.manifest.json")"
[ "$TARGET_ID" != "$SOURCE_ID" ] || die "destinazione identica all'origine registrata nel manifest."
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  load_pg_env "$SOURCE_DATABASE_URL"
  [ "$(target_identity)" = "$SOURCE_ID" ] || die "SOURCE_DATABASE_URL non coincide con l'origine del manifest."
  load_pg_env "$TARGET_DATABASE_URL"
fi
TABLES="$(psql -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")"
[ "$TABLES" = "0" ] || die "destinazione non vuota: $TABLES tabelle presenti."
psql -v ON_ERROR_STOP=1 -Atc "SELECT 1 FROM pg_roles WHERE rolname='$RUNTIME_ROLE'" | grep -q 1 || die "ruolo runtime assente nella destinazione."
pg_restore --exit-on-error --no-owner --dbname "$PGDATABASE" "$BACKUP_FILE"
psql -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM public.schema_migrations" >/dev/null
echo "Ripristino completato. Eseguire verify-readonly, migrate --check e smoke test."
