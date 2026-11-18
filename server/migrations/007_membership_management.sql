-- Privilegi minimi per la gestione dei membri via API amministrativa.
DO $$
DECLARE app_role_name CONSTANT TEXT := 'percorso_app';
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=app_role_name) THEN
  RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app';
 END IF;
 EXECUTE format('GRANT SELECT, UPDATE ON TABLE %I.memberships TO %I',current_schema(),app_role_name);
END
$$;
