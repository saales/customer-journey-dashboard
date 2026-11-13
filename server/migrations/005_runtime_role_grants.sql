-- Privilegi minimi per il ruolo HTTP, distinto dal proprietario dello schema.
DO $$
DECLARE
  app_role_name CONSTANT TEXT := 'percorso_app';
  schema_name TEXT := current_schema();
  app_is_superuser BOOLEAN;
  app_bypasses_rls BOOLEAN;
BEGIN
  SELECT rolsuper, rolbypassrls INTO app_is_superuser, app_bypasses_rls
  FROM pg_roles WHERE rolname = app_role_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app'; END IF;
  IF app_is_superuser OR app_bypasses_rls THEN
    RAISE EXCEPTION 'Il ruolo percorso_app non può avere SUPERUSER o BYPASSRLS';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT SELECT ON TABLE %I.schema_migrations TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT SELECT ON TABLE %I.users, %I.organizations, %I.memberships TO %I', schema_name, schema_name, schema_name, app_role_name);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON TABLE %I.sessions TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.login_attempt_limits TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.customers, %I.events TO %I', schema_name, schema_name, app_role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I.funnel_stages TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE %I.import_batches TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT INSERT ON TABLE %I.audit_logs TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', schema_name, app_role_name);
END
$$;
