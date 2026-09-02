-- Privacy-preserving abuse throttling for login, registration, and access requests.
-- Keys are HMAC digests; raw client addresses are never stored.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset
ON rate_limits(reset_at);

