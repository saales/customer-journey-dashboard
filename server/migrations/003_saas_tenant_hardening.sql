-- PostgreSQL SaaS hardening: external customer identity, session membership
-- integrity, and tenant row-level security.
--
-- Safe for a fresh schema and additive for schemas created by 001/002.
-- Existing customer rows receive a deterministic legacy external ID; this
-- does not claim to recover an external identifier that was never stored.

ALTER TABLE customers
  ADD COLUMN external_id TEXT;

UPDATE customers
SET external_id = 'legacy:' || id::text
WHERE external_id IS NULL;

ALTER TABLE customers
  ALTER COLUMN external_id SET NOT NULL;

CREATE UNIQUE INDEX customers_org_external_id_unique
  ON customers (organization_id, external_id);

-- A session may only select an organization in which its user has a
-- membership. NOT VALID preserves historical rows with a NULL organization_id
-- while enforcing the relationship for new/updated non-NULL values.
ALTER TABLE sessions
  ADD CONSTRAINT sessions_org_user_membership_fk
  FOREIGN KEY (organization_id, user_id)
  REFERENCES memberships (organization_id, user_id)
  ON DELETE CASCADE
  NOT VALID;

-- Defense in depth. The application must still include explicit tenant
-- predicates and set app.current_organization_id inside each transaction.
-- The runtime DB role must not own these tables and must not BYPASSRLS.
DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'customers',
    'events',
    'funnel_stages',
    'import_batches',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (organization_id::text = NULLIF(current_setting(''app.current_organization_id'', true), ''''))
       WITH CHECK (organization_id::text = NULLIF(current_setting(''app.current_organization_id'', true), ''''))',
      tenant_table
    );
  END LOOP;
END
$$;

CREATE INDEX sessions_org_user_expiry_idx
  ON sessions (organization_id, user_id, expires_at);
