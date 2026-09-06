-- 0008_board_shares.sql — Wave H14: member-to-member whiteboard sharing.
-- Read-only grants: an owner shares a board with another member by email.
-- Grantees can GET the shared doc; they can never PUT/POST/DELETE the board
-- or its shares (enforced in worker.js, not in SQL). No existence oracle:
-- share / unshare / read on a board the caller does not own (or that does
-- not exist) all answer with the same generic 404 as the E3 board routes.
-- Apply order: 0001..0007 first, then this file once.
CREATE TABLE IF NOT EXISTS board_shares (
  board_id TEXT NOT NULL,
  shared_with_email TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (board_id, shared_with_email)
);

CREATE INDEX IF NOT EXISTS idx_board_shares_with
ON board_shares(shared_with_email);
