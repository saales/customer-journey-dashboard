-- The admin audit endpoint and export verification require tenant-scoped
-- reads. Keep the runtime role non-owner and subject to the existing RLS policy.
DO $$
DECLARE
  app_role_name CONSTANT TEXT := 'percorso_app';
  schema_name TEXT := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role_name) THEN
    RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app';
  END IF;
  EXECUTE format('GRANT SELECT ON TABLE %I.audit_logs TO %I', schema_name, app_role_name);
END
$$;
