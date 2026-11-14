#!/usr/bin/env bash
set -euo pipefail
die() { echo "ERRORE: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "comando richiesto non trovato: $1"; }
load_pg_env() {
  local url="$1"
  eval "$(URL_IN="$url" node -e '
    const u = new URL(process.env.URL_IN);
    if (!["postgres:", "postgresql:"].includes(u.protocol)) throw new Error("URL PostgreSQL non valida");
    const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    const out = { PGHOST:u.hostname, PGPORT:u.port||"5432", PGUSER:decodeURIComponent(u.username),
      PGPASSWORD:decodeURIComponent(u.password), PGDATABASE:decodeURIComponent(u.pathname.slice(1)),
      PGSSLMODE:u.searchParams.get("sslmode")||"prefer" };
    for (const [k,v] of Object.entries(out)) console.log("export "+k+"="+q(v));
  ')"
}
describe_target() { echo "${PGHOST}:${PGPORT}/${PGDATABASE} (utente ${PGUSER})"; }
confirm_database() {
  [ -n "${1:-}" ] || die "confermare il nome del database."
  [ "$PGDATABASE" = "$1" ] || die "il database collegato non coincide con la conferma."
}
confirm_host() {
  [ -n "${1:-}" ] || die "confermare l'host completo del progetto/database."
  [ "${PGHOST,,}" = "${1,,}" ] || die "l'host collegato non coincide con l'host confermato."
}
require_tls() { [ "${PGSSLMODE:-}" = "require" ] || die "richiesto sslmode=require per gli strumenti staging."; }
target_identity() { printf '%s:%s/%s' "${PGHOST,,}" "$PGPORT" "$PGDATABASE"; }
