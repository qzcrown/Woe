-- Migration: Create plugin_logs table to record plugin execution

CREATE TABLE IF NOT EXISTS plugin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plugin_id) REFERENCES plugin_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plugin_logs_user ON plugin_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_plugin ON plugin_logs(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_event ON plugin_logs(event);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_created ON plugin_logs(created_at DESC);

