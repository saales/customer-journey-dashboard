-- Password reset tokens are high-entropy, single-use secrets; only their SHA-256 hashes are stored.
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX password_reset_tokens_expiry_idx ON password_reset_tokens(expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE password_reset_tokens TO percorso_app;

-- Password recovery is the only runtime flow allowed to change password material.
GRANT UPDATE (password_hash, updated_at) ON TABLE users TO percorso_app;
