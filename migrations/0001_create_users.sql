-- 0001_create_users.sql — World of Ge'or invite-only auth
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  invite_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  used_by TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- seed your default invite
INSERT OR IGNORE INTO invites (code) VALUES ('WELCOME_TO_GEOR_2026');
INSERT OR IGNORE INTO invites (code) VALUES ('MIKHAIL_INVITE');
INSERT OR IGNORE INTO invites (code) VALUES ('ARCADY_INVITE');
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
