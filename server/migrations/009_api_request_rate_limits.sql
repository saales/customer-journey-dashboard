-- Limiti persistenti e condivisi per le richieste HTTP, pseudonimizzati con HMAC.
CREATE TABLE api_request_limits (
    key_hash CHAR(64) PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX api_request_limits_updated_idx
    ON api_request_limits(updated_at);

DO $$
DECLARE
  app_role_name CONSTANT TEXT := 'percorso_app';
  schema_name TEXT := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role_name) THEN
    RAISE EXCEPTION 'Creare prima il ruolo applicativo percorso_app';
  END IF;
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.api_request_limits TO %I',
    schema_name, app_role_name
  );
END
$$;
