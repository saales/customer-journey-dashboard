-- Limiti persistenti per tentativi di accesso.
-- Si conserva esclusivamente un identificatore HMAC, mai indirizzo IP o email.
CREATE TABLE login_attempt_limits (
    key_hash CHAR(64) PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX login_attempt_limits_updated_idx
    ON login_attempt_limits(updated_at);
