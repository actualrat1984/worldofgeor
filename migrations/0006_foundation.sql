-- 0006_foundation.sql — Wave A foundation: roles, reveals, notes, arcs/plots/threads, boards.
-- NOTE: runs once like prior migrations. The ALTER TABLE below is intentionally
-- unguarded (SQLite has no ADD COLUMN IF NOT EXISTS); re-running 0006 will fail
-- on the ALTER while all CREATE TABLE / CREATE INDEX statements are safe no-ops.
-- Apply order: 0001..0005 first, then this file once.

-- 1. roles on users (owner/editor/viewer), default viewer.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';

-- Owner backfill (seed only; no other seed data in this migration).
UPDATE users SET role = 'owner' WHERE email = 'ichieisenheart@gmail.com';

-- 2. reveals: per-member secret state.
CREATE TABLE IF NOT EXISTS reveals (
  member_email TEXT NOT NULL,
  secret_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'locked',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (member_email, secret_id)
);

-- 3. notes: per-member page-anchored marginalia.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_email TEXT NOT NULL,
  page TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 4. arcs: story arcs.
CREATE TABLE IF NOT EXISTS arcs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 5. plots: master plot + subplots tree per arc.
CREATE TABLE IF NOT EXISTS plots (
  id TEXT PRIMARY KEY,
  arc_id TEXT NOT NULL REFERENCES arcs(id),
  parent_id TEXT REFERENCES plots(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  is_master INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

-- 6. threads: open thread tracker per arc.
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  arc_id TEXT NOT NULL REFERENCES arcs(id),
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 7. boards: whiteboard JSON docs.
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL,
  doc_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 8. indexes.
CREATE INDEX IF NOT EXISTS idx_reveals_member ON reveals(member_email);
CREATE INDEX IF NOT EXISTS idx_notes_member_page ON notes(member_email, page);
CREATE INDEX IF NOT EXISTS idx_plots_arc_parent ON plots(arc_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_threads_arc_state ON threads(arc_id, state);
