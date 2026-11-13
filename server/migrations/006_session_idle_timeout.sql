-- Consente al runtime di aggiornare esclusivamente l'ultimo utilizzo della sessione.
-- La scadenza assoluta resta impostata al momento dell'autenticazione.
DO $$
DECLARE
  app_role_name CONSTANT TEXT := 'percorso_app';
  schema_name TEXT := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role_name) THEN
    RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app';
  END IF;
  EXECUTE format(
    'GRANT UPDATE (last_used_at) ON TABLE %I.sessions TO %I',
    schema_name,
    app_role_name
  );
END
$$;
