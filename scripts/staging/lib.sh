#!/usr/bin/env bash
# Funzioni comuni degli script di staging. Nessuna credenziale viene stampata né passata come
# argomento di processo: la stringa di connessione viene convertita in variabili PG* (libpq).
set -euo pipefail

die() { echo "ERRORE: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "comando richiesto non trovato: $1"; }

# Esporta PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE a partire da una URL postgresql://
# Uso: load_pg_env "$URL"
load_pg_env() {
  local url="$1"
  eval "$(URL_IN="$url" node -e '
    const u = new URL(process.env.URL_IN);
    const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    const out = {
      PGHOST: u.hostname, PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
      PGSSLMODE: u.searchParams.get("sslmode") || "prefer",
    };
    for (const [k, v] of Object.entries(out)) console.log("export " + k + "=" + q(v));
  ')"
}

# Stampa host:porta/database senza credenziali (identifica la destinazione).
describe_target() { echo "${PGHOST}:${PGPORT}/${PGDATABASE} (utente ${PGUSER})"; }

# Rifiuta di procedere se il database collegato non ha il nome confermato dall'operatore.
confirm_database() {
  local expected="$1"
  [ -n "$expected" ] || die "confermare il database di destinazione (variabile CONFIRM_DATABASE)."
  [ "$PGDATABASE" = "$expected" ] || die "il database collegato è '$PGDATABASE', la conferma indica '$expected'. Nessuna operazione eseguita."
}
