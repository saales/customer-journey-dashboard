#!/usr/bin/env bash
# Impone HTTPS e configurazione cross-tenant prima dello smoke test.
set -euo pipefail
: "${STAGING_URL:?impostare STAGING_URL}"
case "$STAGING_URL" in https://*) ;; *) echo "ERRORE: STAGING_URL deve usare HTTPS." >&2; exit 1 ;; esac
CREDENTIALS=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--credentials" ]; then CREDENTIALS="${2:-}"; break; fi
  shift
done
[ -n "$CREDENTIALS" ] && [ -f "$CREDENTIALS" ] || { echo "ERRORE: --credentials <file> obbligatorio." >&2; exit 1; }
node - "$CREDENTIALS" <<'NODE'
const c=require(require("node:path").resolve(process.argv[2]));
if (!c.otherTenant?.organizationSlug || !c.otherTenant?.admin?.email || !c.otherTenant?.admin?.password) {
  console.error("ERRORE: credentials.json deve includere otherTenant (slug, admin.email, admin.password).");
  process.exit(1);
}
NODE
exec node scripts/staging/smoke.mjs "$@"
