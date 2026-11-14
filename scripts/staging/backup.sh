#!/usr/bin/env bash
# Backup logico read-only; conferma separata di database e host.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_cmd pg_dump; require_cmd pg_restore; require_cmd sha256sum; require_cmd node
[ -n "${SOURCE_DATABASE_URL:-}" ] || die "impostare SOURCE_DATABASE_URL."
load_pg_env "$SOURCE_DATABASE_URL"
confirm_database "${CONFIRM_DATABASE:-}"
confirm_host "${CONFIRM_HOST:-}"
require_tls
case "$PGHOST" in *-pooler.*) die "usare endpoint diretto, non pooler, per pg_dump." ;; esac
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/${PGDATABASE}_${STAMP}.dump"
echo "Origine confermata: $(describe_target)"
SERVER_MAJOR="$(psql -v ON_ERROR_STOP=1 -Atc "SHOW server_version_num" | cut -c1-2)"
CLIENT_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
[ "$CLIENT_MAJOR" -ge "$SERVER_MAJOR" ] || die "pg_dump è più vecchio del server."
pg_dump --format=custom --no-owner --compress=6 --file "$FILE"
chmod 600 "$FILE"
pg_restore --list "$FILE" >/dev/null || die "dump non leggibile."
SUM="$(sha256sum "$FILE" | cut -d' ' -f1)"
MIGRATIONS="$(psql -v ON_ERROR_STOP=1 -Atc "SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM public.schema_migrations) END")"
SERVER_VERSION="$(psql -v ON_ERROR_STOP=1 -Atc 'SHOW server_version')"
BYTES="$(wc -c < "$FILE" | tr -d ' ')"
node - "$FILE.manifest.json" "$(basename "$FILE")" "$SUM" "$STAMP" "$PGHOST" "$PGPORT" "$PGDATABASE" "$SERVER_VERSION" "$BYTES" "$MIGRATIONS" <<'NODE'
const fs=require("node:fs");
const [path,file,sha256,createdAtUtc,sourceHost,sourcePort,sourceDatabase,serverVersion,bytes,migrationsRecorded]=process.argv.slice(2);
fs.writeFileSync(path,JSON.stringify({file,sha256,createdAtUtc,sourceHost,sourcePort:Number(sourcePort),sourceDatabase,serverVersion,bytes:Number(bytes),migrationsRecorded:Number(migrationsRecorded)},null,2)+"\n",{mode:0o600,flag:"wx"});
NODE
chmod 600 "$FILE.manifest.json"
echo "Backup completato: $FILE"
echo "Manifest SHA-256 creato."
