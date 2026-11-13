-- Protegge gli inviti per organizzazione e abilita esclusivamente i flussi di accettazione.
DO $$
DECLARE
  app_role_name CONSTANT TEXT := 'percorso_app';
  schema_name TEXT := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role_name) THEN
    RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app';
  END IF;
  EXECUTE format('ALTER TABLE %I.invitations ENABLE ROW LEVEL SECURITY', schema_name);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %I.invitations
     USING (organization_id::text = NULLIF(current_setting(''app.current_organization_id'', true), ''''))
     WITH CHECK (organization_id::text = NULLIF(current_setting(''app.current_organization_id'', true), ''''))',
    schema_name
  );
  EXECUTE format(
    'CREATE POLICY invitation_token_lookup ON %I.invitations FOR SELECT
     USING (token_hash = NULLIF(current_setting(''app.invitation_token_hash'', true), ''''))',
    schema_name
  );
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I.invitations TO %I', schema_name, app_role_name);
  EXECUTE format('GRANT INSERT ON TABLE %I.users, %I.memberships TO %I', schema_name, schema_name, app_role_name);
END
$$;
