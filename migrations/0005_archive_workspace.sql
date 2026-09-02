-- Cross-device member library and a shared editorial workflow.
CREATE TABLE IF NOT EXISTS member_library (
  user_email TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'folio',
  progress INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  last_visited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (user_email, path)
);

CREATE INDEX IF NOT EXISTS idx_member_library_recent
ON member_library(user_email, last_visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_library_saved
ON member_library(user_email, saved, updated_at DESC)
WHERE saved = 1;

CREATE TABLE IF NOT EXISTS workflow_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  content_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(kind, path)
);

CREATE INDEX IF NOT EXISTS idx_workflow_status_updated
ON workflow_items(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_history_item
ON workflow_history(workflow_id, created_at DESC);
