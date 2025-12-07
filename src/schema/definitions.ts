export type SqlType = "INTEGER" | "TEXT" | "REAL" | "BLOB";

export interface ColumnDef {
  name: string;
  type: SqlType;
  notNull?: boolean;
  unique?: boolean;
  default?: string | number | boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
}

export interface ForeignKeyDef {
  column: string;
  refTable: string;
  refColumn: string;
  onDelete?: string;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique?: boolean;
  desc?: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  foreignKeys?: ForeignKeyDef[];
  indexes?: IndexDef[];
}

function colSql(c: ColumnDef): string {
  const parts: string[] = [c.name, c.type];
  if (c.primaryKey) parts.push("PRIMARY KEY");
  if (c.autoIncrement) parts.push("AUTOINCREMENT");
  if (c.notNull) parts.push("NOT NULL");
  if (c.unique) parts.push("UNIQUE");
  if (c.default !== undefined) {
    if (typeof c.default === "string" && c.default.toUpperCase() === "CURRENT_TIMESTAMP") {
      parts.push("DEFAULT CURRENT_TIMESTAMP");
    } else if (typeof c.default === "boolean") {
      parts.push(`DEFAULT ${c.default ? 1 : 0}`);
    } else {
      parts.push(`DEFAULT ${c.default}`);
    }
  }
  return parts.join(" ");
}

export function createTableSQL(def: TableDef): string {
  const cols = def.columns.map(colSql);
  const fks = (def.foreignKeys || []).map(
    (fk) => `FOREIGN KEY(${fk.column}) REFERENCES ${fk.refTable}(${fk.refColumn})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ""}`
  );
  const body = [...cols, ...fks].join(", ");
  return `CREATE TABLE IF NOT EXISTS ${def.name} (${body})`;
}

export const schemaDefinitions: TableDef[] = [
  {
    name: "users",
    columns: [
      { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true },
      { name: "name", type: "TEXT", notNull: true, unique: true },
      { name: "pass", type: "TEXT", notNull: true },
      { name: "admin", type: "INTEGER", notNull: true, default: 0 },
      { name: "disabled", type: "INTEGER", notNull: true, default: 0 },
      { name: "created_at", type: "TEXT", default: "CURRENT_TIMESTAMP" }
    ],
    indexes: [
      { name: "idx_users_name_unique", columns: ["name"], unique: true },
      { name: "idx_users_disabled", columns: ["disabled"] }
    ]
  },
  {
    name: "applications",
    columns: [
      { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true },
      { name: "user_id", type: "INTEGER", notNull: true },
      { name: "token", type: "TEXT", notNull: true, unique: true },
      { name: "name", type: "TEXT", notNull: true },
      { name: "description", type: "TEXT" },
      { name: "default_priority", type: "INTEGER", default: 0 },
      { name: "image", type: "TEXT" },
      { name: "internal", type: "INTEGER", default: 0 },
      { name: "last_used", type: "TEXT" },
      { name: "created_at", type: "TEXT", default: "CURRENT_TIMESTAMP" },
      { name: "updated_at", type: "TEXT", default: "CURRENT_TIMESTAMP" }
    ],
    foreignKeys: [
      { column: "user_id", refTable: "users", refColumn: "id" }
    ],
    indexes: [
      { name: "idx_applications_token", columns: ["token"], unique: true },
      { name: "idx_applications_user", columns: ["user_id"] }
    ]
  },
  {
    name: "clients",
    columns: [
      { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true },
      { name: "user_id", type: "INTEGER", notNull: true },
      { name: "token", type: "TEXT", notNull: true, unique: true },
      { name: "name", type: "TEXT", notNull: true },
      { name: "last_used", type: "TEXT" },
      { name: "created_at", type: "TEXT", default: "CURRENT_TIMESTAMP" }
    ],
    foreignKeys: [
      { column: "user_id", refTable: "users", refColumn: "id" }
    ],
    indexes: [
      { name: "idx_clients_token", columns: ["token"], unique: true },
      { name: "idx_clients_user", columns: ["user_id"] }
    ]
  },
  {
    name: "messages",
    columns: [
      { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true },
      { name: "userid", type: "INTEGER", notNull: true },
      { name: "appid", type: "INTEGER", notNull: true },
      { name: "message", type: "TEXT", notNull: true },
      { name: "title", type: "TEXT" },
      { name: "priority", type: "INTEGER", default: 0 },
      { name: "extras", type: "TEXT" },
      { name: "date", type: "TEXT", default: "CURRENT_TIMESTAMP" },
      { name: "expires", type: "TEXT" }
    ],
    foreignKeys: [
      { column: "appid", refTable: "applications", refColumn: "id" }
    ],
    indexes: [
      { name: "idx_messages_app_id", columns: ["appid"] },
      { name: "idx_messages_date", columns: ["date"], desc: true },
      { name: "idx_messages_priority", columns: ["priority"], desc: true }
    ]
  },
  {
    name: "system_state",
    columns: [
      { name: "key", type: "TEXT", primaryKey: true },
      { name: "value", type: "TEXT", notNull: true },
      { name: "created_at", type: "TEXT", default: "CURRENT_TIMESTAMP" },
      { name: "updated_at", type: "TEXT", default: "CURRENT_TIMESTAMP" }
    ],
    indexes: [
      { name: "idx_system_state_key", columns: ["key"] }
    ]
  },
  {
    name: "plugin_configs",
    columns: [
      { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true },
      { name: "user_id", type: "INTEGER", notNull: true },
      { name: "name", type: "TEXT", notNull: true },
      { name: "token", type: "TEXT", notNull: true },
      { name: "module_path", type: "TEXT", notNull: true },
      { name: "config_yaml", type: "TEXT" },
      { name: "enabled", type: "INTEGER", notNull: true, default: 1 },
      { name: "created_at", type: "TEXT", notNull: true, default: "CURRENT_TIMESTAMP" },
      { name: "updated_at", type: "TEXT", notNull: true, default: "CURRENT_TIMESTAMP" }
    ],
    indexes: [
      { name: "idx_plugin_configs_user_id", columns: ["user_id"] },
      { name: "idx_plugin_configs_token", columns: ["token"] },
      { name: "idx_plugin_configs_module_path", columns: ["module_path"] },
      { name: "idx_plugin_configs_enabled", columns: ["enabled"] }
    ]
  },
  {
    name: "plugin_logs",
    columns: [
      { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true },
      { name: "plugin_id", type: "INTEGER", notNull: true },
      { name: "user_id", type: "INTEGER", notNull: true },
      { name: "event", type: "TEXT", notNull: true },
      { name: "status", type: "INTEGER", notNull: true },
      { name: "duration_ms", type: "INTEGER" },
      { name: "error", type: "TEXT" },
      { name: "created_at", type: "TEXT", default: "CURRENT_TIMESTAMP" }
    ],
    foreignKeys: [
      { column: "plugin_id", refTable: "plugin_configs", refColumn: "id", onDelete: "CASCADE" },
      { column: "user_id", refTable: "users", refColumn: "id", onDelete: "CASCADE" }
    ],
    indexes: [
      { name: "idx_plugin_logs_user", columns: ["user_id"] },
      { name: "idx_plugin_logs_plugin", columns: ["plugin_id"] },
      { name: "idx_plugin_logs_event", columns: ["event"] },
      { name: "idx_plugin_logs_created", columns: ["created_at"] }
    ]
  }
];

export function createIndexSQL(t: TableDef, idx: IndexDef): string {
  const uniq = idx.unique ? "UNIQUE " : "";
  const cols = idx.columns.map((c) => (idx.desc ? `${c} DESC` : c)).join(", ");
  return `CREATE ${uniq}INDEX IF NOT EXISTS ${idx.name} ON ${t.name}(${cols})`;
}

