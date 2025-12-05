// Migration loader
// Loads SQL migration files and exports them as strings

// Import migration SQL files
// The [[rules]] configuration in wrangler.toml makes these available as text modules
import migration001 from "../../migrations/001_initial_schema.sql";
import migration003 from "../../migrations/0003_create_plugin_configs_table.sql";
import migration004 from "../../migrations/0004_add_initialization_support.sql";
import migration005 from "../../migrations/0005_plugin_logs.sql";

export const migrations = {
  MIGRATION_001: migration001,
  MIGRATION_003: migration003,
  MIGRATION_004: migration004,
  MIGRATION_005: migration005
};

export default migrations;
