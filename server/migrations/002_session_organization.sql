-- Associa ogni sessione a una specifica organizzazione.
-- Le sessioni esistenti non vengono inventate/assegnate automaticamente.
ALTER TABLE sessions
  ADD COLUMN organization_id UUID
  REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX sessions_org_expiry_idx
  ON sessions(organization_id, expires_at);
