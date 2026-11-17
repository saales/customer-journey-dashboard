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
  local exports
  exports="$(URL_IN="$url" node -e '
    const u = new URL(process.env.URL_IN);
    const net = require("node:net");
    if (!["postgres:", "postgresql:"].includes(u.protocol)) throw new Error("URL PostgreSQL non valida.");
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const local = host === "localhost" || host === "::1" ||
      (net.isIP(host) === 4 && host.split(".")[0] === "127");
    const sslModes = u.searchParams.getAll("sslmode");
    if (sslModes.length > 1) throw new Error("Specificare una sola modalità sslmode.");
    const sslMode = sslModes[0] || (local ? "disable" : "verify-full");
    if (!local && sslMode !== "verify-full") {
      throw new Error("Le connessioni PostgreSQL remote richiedono sslmode=verify-full.");
    }
    const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    const out = {
      PGHOST: u.hostname, PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
      PGSSLMODE: sslMode,
    };
    for (const [k, v] of Object.entries(out)) console.log("export " + k + "=" + q(v));
  ')" || die "URL PostgreSQL non valida o modalità TLS non sicura."
  eval "$exports"
}

# Stampa host:porta/database senza credenziali (identifica la destinazione).
describe_target() { echo "${PGHOST}:${PGPORT}/${PGDATABASE} (utente ${PGUSER})"; }

# Rifiuta di procedere se il database collegato non ha il nome confermato dall'operatore.
confirm_database() {
  local expected="$1"
  [ -n "$expected" ] || die "confermare il database di destinazione (variabile CONFIRM_DATABASE)."
  [ "$PGDATABASE" = "$expected" ] || die "il database collegato è '$PGDATABASE', la conferma indica '$expected'. Nessuna operazione eseguita."
}
