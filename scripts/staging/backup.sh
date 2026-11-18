#!/usr/bin/env bash
# Backup logico (pg_dump, formato custom) del database indicato, con checksum e manifest.
#
#   SOURCE_DATABASE_URL=postgresql://...   (endpoint DIRETTO, non pooler; ruolo proprietario o di sola lettura)
#   CONFIRM_DATABASE=<nome database>       (conferma esplicita del database da copiare)
#   BACKUP_DIR=./backups                   (opzionale)
#
# Il comando è di SOLA LETTURA sul database di origine. Il file prodotto contiene dati: va
# trattato come dato riservato (cifrato a riposo, accesso limitato, mai nel repository).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_cmd pg_dump; require_cmd pg_restore; require_cmd sha256sum; require_cmd node

[ -n "${SOURCE_DATABASE_URL:-}" ] || die "impostare SOURCE_DATABASE_URL."
load_pg_env "$SOURCE_DATABASE_URL"
confirm_database "${CONFIRM_DATABASE:-}"
case "$PGHOST" in *-pooler.*) die "usare l'endpoint DIRETTO (senza -pooler) per pg_dump." ;; esac

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/${PGDATABASE}_${STAMP}.dump"

echo "Origine: $(describe_target)"
SERVER_MAJOR="$(psql -Atc "SHOW server_version_num" | cut -c1-2)"
CLIENT_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
[ "$CLIENT_MAJOR" -ge "$SERVER_MAJOR" ] || die "pg_dump $CLIENT_MAJOR è più vecchio del server $SERVER_MAJOR: aggiornare i client PostgreSQL."

# --no-owner: il ripristino non dipende dai nomi dei ruoli proprietari; i privilegi (ACL) restano nel dump.
pg_dump --format=custom --no-owner --compress=6 --file "$FILE"
chmod 600 "$FILE"
pg_restore --list "$FILE" >/dev/null || die "il dump prodotto non è leggibile da pg_restore."

SUM="$(sha256sum "$FILE" | cut -d' ' -f1)"
{
  echo "{"
  echo "  \"file\": \"$(basename "$FILE")\","
  echo "  \"sha256\": \"$SUM\","
  echo "  \"createdAtUtc\": \"$STAMP\","
  echo "  \"sourceDatabase\": \"$PGDATABASE\","
  echo "  \"serverVersion\": \"$(psql -Atc 'SHOW server_version' | tr -d '"')\","
  echo "  \"bytes\": $(wc -c < "$FILE"),"
  echo "  \"migrationsRecorded\": $(psql -Atc 'SELECT COUNT(*) FROM public.schema_migrations')"
  echo "}"
} > "$FILE.manifest.json"
echo "Backup completato: $FILE"
echo "SHA-256: $SUM"
echo "Manifest: $FILE.manifest.json"
