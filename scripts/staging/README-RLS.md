# Verifica effettiva delle policy RLS

Eseguire dopo le migrazioni con un ruolo che possa leggere il catalogo PostgreSQL:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/staging/verify-rls-policy-shapes.sql
```

La verifica è read-only. Non si limita al nome `tenant_isolation`: richiede RLS attiva, policy `ALL`, espressioni `USING` e `WITH CHECK` entrambe legate a `organization_id` e `app.current_organization_id`, e la policy di lookup inviti vincolata al token. Una policy omonima permissiva non supera il controllo.
