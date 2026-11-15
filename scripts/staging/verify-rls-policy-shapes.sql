-- Verifica strutturale read-only delle policy RLS tenant.
-- Fallisce se una policy manca, non copre ALL, o non vincola USING e WITH CHECK
-- al contesto app.current_organization_id.
DO $$
DECLARE
  tenant_table TEXT;
  policy_count INTEGER;
  problems TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'customers', 'events', 'funnel_stages', 'import_batches', 'audit_logs', 'invitations'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=tenant_table AND c.relrowsecurity
    ) THEN
      problems := array_append(problems, tenant_table || ': RLS assente/disattivata');
    END IF;

    SELECT COUNT(*) INTO policy_count
    FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename=tenant_table
      AND p.policyname='tenant_isolation' AND p.cmd='ALL'
      AND p.qual IS NOT NULL AND p.with_check IS NOT NULL
      AND position('organization_id' in lower(p.qual)) > 0
      AND position('app.current_organization_id' in lower(p.qual)) > 0
      AND lower(trim(p.qual)) <> 'true'
      AND position('organization_id' in lower(p.with_check)) > 0
      AND position('app.current_organization_id' in lower(p.with_check)) > 0
      AND lower(trim(p.with_check)) <> 'true';
    IF policy_count = 0 THEN
      problems := array_append(problems, tenant_table || ': tenant_isolation non vincolante o incompleta');
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO policy_count
  FROM pg_policies p
  WHERE p.schemaname='public' AND p.tablename='invitations'
    AND p.policyname='invitation_token_lookup' AND p.cmd='SELECT'
    AND p.qual IS NOT NULL
    AND position('token_hash' in lower(p.qual)) > 0
    AND position('app.invitation_token_hash' in lower(p.qual)) > 0;
  IF policy_count = 0 THEN
    problems := array_append(problems, 'invitations: invitation_token_lookup assente o non vincolata al token');
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'Verifica RLS fallita: %', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'Verifica RLS superata: 6 tabelle tenant e lookup inviti.';
END
$$;
