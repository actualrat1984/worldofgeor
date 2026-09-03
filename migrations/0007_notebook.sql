-- 0007_notebook.sql — Wave E2: per-member notebook (quick notes + checklists).
-- Standalone member-scoped notes with titles and structured checklists.
-- NOT a reuse of the 0006 `notes` table: that table is page-anchored
-- marginalia (page/anchor/shared columns, idx_notes_member_page access
-- pattern) and has no title or checklist shape. A sentinel-page hack would
-- break its semantics, so the notebook gets its own table + index.
-- Apply order: 0001..0006 first, then this file once.
CREATE TABLE IF NOT EXISTS notebook_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_notebook_notes_member_updated
ON notebook_notes(member_email, updated_at DESC);
