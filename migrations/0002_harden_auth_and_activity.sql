CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  path TEXT,
  summary TEXT NOT NULL,
  actor_email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_status_created
ON requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_created
ON activity(created_at DESC);

-- Remove the repository-visible bootstrap invitations if they were never redeemed.
DELETE FROM invites
WHERE used_by IS NULL
  AND code IN ('WELCOME_TO_GEOR_2026', 'MIKHAIL_INVITE', 'ARCADY_INVITE');
