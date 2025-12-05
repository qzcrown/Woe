-- Migration: Create plugin_configs table for plugin management
-- Description: Stores plugin configurations and states

CREATE TABLE IF NOT EXISTS plugin_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    module_path TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    config_yaml TEXT,
    capabilities TEXT, -- JSON array stored as text
    author TEXT,
    license TEXT,
    website TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plugin_configs_user_id ON plugin_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_plugin_configs_token ON plugin_configs(token);
CREATE INDEX IF NOT EXISTS idx_plugin_configs_module_path ON plugin_configs(module_path);
CREATE INDEX IF NOT EXISTS idx_plugin_configs_enabled ON plugin_configs(enabled);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_plugin_configs_timestamp
AFTER UPDATE ON plugin_configs
FOR EACH ROW
BEGIN
    UPDATE plugin_configs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
