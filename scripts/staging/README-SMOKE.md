# Smoke test staging

Eseguire con:
```bash
STAGING_URL=https://<staging> scripts/staging/run-smoke.sh --credentials ./credentials.json --seed --evidence-dir ./evidence
```
Il wrapper rifiuta HTTP e richiede le credenziali del secondo tenant, così il test cross-tenant non può essere saltato per omissione della configurazione. Le credenziali restano locali e non vanno caricate nel repository.
