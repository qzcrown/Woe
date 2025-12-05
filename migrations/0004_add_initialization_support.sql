-- Add system state tracking and user disable functionality for initialization feature
-- Also adds _migrations table to track applied migrations

-- Migrations tracking table
CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_state (key, value) VALUES ('is_initialized', 'false');

-- Add disabled flag to users table for future account disabling
ALTER TABLE users ADD COLUMN disabled BOOLEAN NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_disabled ON users(disabled);

CREATE INDEX IF NOT EXISTS idx_system_state_key ON system_state(key);
