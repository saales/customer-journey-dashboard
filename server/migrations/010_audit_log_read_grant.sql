-- La consultazione dell'audit è riservata all'API admin, ma il ruolo runtime
-- necessita del privilegio SQL SELECT per eseguire la query tenant-scoped.
-- La policy RLS continua a limitare le righe all'organizzazione di sessione.
DO $$
DECLARE
  app_role_name CONSTANT TEXT := 'percorso_app';
  schema_name TEXT := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role_name) THEN
    RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app';
  END IF;
  EXECUTE format(
    'GRANT SELECT ON TABLE %I.audit_logs TO %I',
    schema_name, app_role_name
  );
END
$$;
