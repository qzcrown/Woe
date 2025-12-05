-- Woe Database Schema (Based on Gotify API v2.0.2)

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    pass TEXT NOT NULL, -- 加密存储
    admin BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    default_priority INTEGER DEFAULT 0,
    image TEXT, -- R2 存储的URL
    internal BOOLEAN DEFAULT 0,
    last_used DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    last_used DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userid INTEGER NOT NULL,
    appid INTEGER NOT NULL,
    message TEXT NOT NULL,
    title TEXT,
    priority INTEGER DEFAULT 0,
    extras TEXT, -- JSON 数据存储
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires DATETIME,
    FOREIGN KEY (appid) REFERENCES applications(id)
);

-- 性能优化索引
CREATE INDEX IF NOT EXISTS idx_messages_app_id ON messages(appid);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_priority ON messages(priority DESC);
CREATE INDEX IF NOT EXISTS idx_applications_token ON applications(token);
CREATE INDEX IF NOT EXISTS idx_clients_token ON clients(token);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
