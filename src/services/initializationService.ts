// Initialization service for Woe worker
// Handles system initialization logic triggered on first login with default credentials

import { Env } from "../types/index.ts";
import { migrations } from "../migrations/index.ts";

export interface InitializationResult {
  success: boolean;
  adminUserId?: number;
  error?: string;
}

export class InitializationService {
  constructor(private db: D1Database) {}

  /**
   * Check if a table exists in the database
   */
  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name = ?
      `).bind(tableName).first<{ name: string }>();

      return !!result;
    } catch (error) {
      // Log only actual errors, not missing tables
      if (this.isActualError(error)) {
        console.error(`Error checking if table '${tableName}' exists:`, error);
      }
      return false;
    }
  }

  /**
   * Check if an error represents an actual problem vs expected state
   */
  private isActualError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Filter out expected "no such table" errors
      return !message.includes('no such table') &&
             !message.includes('doesn\'t exist') &&
             !message.includes('does not exist');
    }
    return true;
  }

  /**
   * Check if the system has been initialized
   */
  async isSystemInitialized(): Promise<boolean> {
    try {
      // Check if system_state table exists first
      const tableExists = await this.tableExists('system_state');
      if (!tableExists) {
        // Table doesn't exist = system not initialized (normal state)
        return false;
      }

      const result = await this.db.prepare(`
        SELECT value FROM system_state WHERE key = 'is_initialized'
      `).first<{ value: string }>();

      if (!result) {
        // If no state record, consider uninitialized
        return false;
      }

      return result.value === 'true';
    } catch (error) {
      // Only log actual errors
      if (this.isActualError(error)) {
        console.error("Error checking system initialization status:", error);
      }
      // If we can't check, assume not initialized (safer)
      return false;
    }
  }

  /**
   * Check if migrations need to be applied
   * Returns true if _migrations table doesn't exist or if migrations are missing
   */
  async checkIfMigrationsNeeded(): Promise<boolean> {
    try {
      const migrationsTable = await this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name = '_migrations'
      `).first();

      const bundled = [
        "001_initial_schema",
        "0003_create_plugin_configs_table",
        "0004_add_initialization_support",
        "0005_plugin_logs"
      ];

      if (!migrationsTable) {
        return true;
      }

      const appliedRows = await this.db.prepare(`
        SELECT name FROM _migrations
      `).all();
      const applied = new Set((appliedRows.results || []).map((r: any) => r.name as string));
      for (const name of bundled) {
        if (!applied.has(name)) return true;
      }
      return false;
    } catch (error) {
      console.error("Error checking migration status:", error);
      return true;
    }
  }

  /**
   * Check if a specific migration has been applied
   * For the first migration (001), checks if the users table exists
   * For subsequent migrations, checks the _migrations table
   */
  async hasMigrationBeenApplied(name: string): Promise<boolean> {
    try {
      // Check if _migrations table exists
      const migrationsTableExists = await this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name = '_migrations'
      `).first();

      if (migrationsTableExists) {
        // If _migrations table exists, check it
        const result = await this.db.prepare(`
          SELECT name FROM _migrations WHERE name = ?
        `).bind(name).first();
        return !!result;
      } else {
        // _migrations table doesn't exist yet, check if the migration's tables exist
        switch (name) {
          case "001_initial_schema":
            // Check if users table exists
            const usersTable = await this.db.prepare(`
              SELECT name FROM sqlite_master WHERE type='table' AND name = 'users'
            `).first();
            return !!usersTable;

          case "0003_create_plugin_configs_table":
            // Check if plugin_configs table exists
            const pluginTable = await this.db.prepare(`
              SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_configs'
            `).first();
            return !!pluginTable;

          case "0004_add_initialization_support":
            // Check if system_state table exists
            const stateTable = await this.db.prepare(`
              SELECT name FROM sqlite_master WHERE type='table' AND name = 'system_state'
            `).first();
            return !!stateTable;

          case "0005_plugin_logs":
            const logsTable = await this.db.prepare(`
              SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_logs'
            `).first();
            return !!logsTable;

          default:
            return false;
        }
      }
    } catch (error) {
      console.error(`Error checking if migration '${name}' was applied:`, error);
      return false;
    }
  }

  /**
   * Execute a single migration
   */
  async executeMigration(name: string, sql: string): Promise<boolean> {
    try {
      console.log(`Executing migration: ${name}`);

      // Execute the migration SQL
      await this.db.prepare(sql).run();

      // Try to record that this migration was applied
      // (might fail if _migrations table doesn't exist yet, which is OK)
      try {
        await this.db.prepare(`
          INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))
        `).bind(name).run();
      } catch (recordError) {
        // _migrations table might not exist yet (for migrations 001-003)
        // This is expected during initial setup
        console.log(`Could not record migration ${name} (expected during initial setup)`);
      }

      console.log(`Migration ${name} applied successfully`);
      return true;

    } catch (error) {
      console.error(`Failed to execute migration ${name}:`, error);
      return false;
    }
  }

  /**
   * Apply all migrations from the bundled SQL files
   */
  async applyAllMigrations(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log("Starting database migrations...");

      // Define migrations in order
      const migrationList = [
        { name: "001_initial_schema", sql: migrations.MIGRATION_001 },
        { name: "0003_create_plugin_configs_table", sql: migrations.MIGRATION_003 },
        { name: "0004_add_initialization_support", sql: migrations.MIGRATION_004 },
        { name: "0005_plugin_logs", sql: migrations.MIGRATION_005 }
      ];

      const rows = await this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name = '_migrations'
      `).first();
      if (!rows) {
        // Ensure _migrations exists (from 0004)
        await this.db.prepare(`
          CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
      }

      for (const migration of migrationList) {
        if (!migration.sql || migration.sql.trim() === "") continue;
        const alreadyApplied = await this.hasMigrationBeenApplied(migration.name);
        if (alreadyApplied) continue;
        const success = await this.executeMigration(migration.name, migration.sql);
        if (!success) {
          return { success: false, error: `Failed to apply migration ${migration.name}` };
        }

        // Post-migration fixups for idempotency gaps (SQLite ALTER COLUMN IF NOT EXISTS not supported)
        if (migration.name === "0004_add_initialization_support") {
          // Ensure users.disabled column exists
          try {
            const cols = await this.db.prepare(`PRAGMA table_info('users')`).all();
            const hasDisabled = (cols.results || []).some((r: any) => r.name === 'disabled');
            if (!hasDisabled) {
              await this.db.prepare(`ALTER TABLE users ADD COLUMN disabled BOOLEAN NOT NULL DEFAULT 0`).run();
            }
            // Ensure indexes exist
            await this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_disabled ON users(disabled)`).run();
            await this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_system_state_key ON system_state(key)`).run();
            // Seed system_state key if missing
            await this.db.prepare(`INSERT OR IGNORE INTO system_state (key, value) VALUES ('is_initialized', 'false')`).run();
          } catch (e) {
            console.warn('Post-migration fixups failed:', e instanceof Error ? e.message : e);
          }
        }
      }

      console.log("All migrations applied successfully");
      return { success: true };

    } catch (error) {
      console.error("Error applying migrations:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during migrations"
      };
    }
  }

  async runAutoMigrationsIfNeeded(): Promise<void> {
    try {
      const needs = await this.checkIfMigrationsNeeded();
      if (!needs) return;
      await this.applyAllMigrations();
    } catch (e) {
      console.warn("Auto migration skipped due to error:", e instanceof Error ? e.message : e);
    }
  }

  /**
   * Perform system initialization
   * Creates admin user and marks system as initialized
   */
  async initializeSystem(env: Env): Promise<InitializationResult> {
    try {
      // Double-check not already initialized (race condition prevention)
      const alreadyInitialized = await this.isSystemInitialized();
      if (alreadyInitialized) {
        return {
          success: false,
          error: "System is already initialized"
        };
      }

      // Default credentials are optional for pure migration stage

      // Check if migrations need to be applied
      const needsMigrations = await this.checkIfMigrationsNeeded();

      // Apply migrations if needed
      if (needsMigrations) {
        console.log("Database schema not found, applying migrations...");
        const migrationResult = await this.applyAllMigrations();
        if (!migrationResult.success) {
          return {
            success: false,
            error: `Migration failed: ${migrationResult.error}`
          };
        }
        console.log("Migrations applied successfully");
      }

      // Validate database is ready
      const dbReady = await this.validateDatabase();
      if (!dbReady) {
        return {
          success: false,
          error: "Database validation failed"
        };
      }

      // Do not create admin user here; admin will be created via setup endpoint
      const adminUserId = undefined;

      // Mark system as initialized
      await this.markAsInitialized();

      console.log(`System initialization (migrations + validation) completed`);

      return {
        success: true
      };

    } catch (error) {
      console.error("System initialization failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during initialization"
      };
    }
  }

  /**
   * Validate database is ready for initialization
   */
  async validateDatabase(): Promise<boolean> {
    try {
      // Test basic query
      await this.db.prepare("SELECT 1 as test").first();

      // Check required tables exist
      const requiredTables = ['users', 'applications', 'clients', 'messages', 'system_state'];

      for (const table of requiredTables) {
        const result = await this.db.prepare(`
          SELECT name FROM sqlite_master WHERE type='table' AND name = ?
        `).bind(table).first();

        if (!result) {
          console.error(`Required table '${table}' does not exist`);
          return false;
        }
      }

      console.log("Database validation passed");
      return true;

    } catch (error) {
      console.error("Database validation failed:", error);
      return false;
    }
  }

  /**
   * Mark system as initialized atomically
   */
  async markAsInitialized(): Promise<void> {
    try {
      await this.db.prepare(`
        UPDATE system_state
        SET value = 'true', updated_at = datetime('now')
        WHERE key = 'is_initialized'
      `).run();

      console.log("System marked as initialized");
    } catch (error) {
      console.error("Failed to mark system as initialized:", error);
      throw error;
    }
  }

  /**
   * Create admin user
   */
  async createAdminUser(username: string, password: string): Promise<number | null> {
    try {
      // Check if user already exists
      const existingUser = await this.db.prepare(`
        SELECT id FROM users WHERE name = ?
      `).bind(username).first();

      if (existingUser) {
        console.error(`User '${username}' already exists`);
        return null;
      }

      const result = await this.db.prepare(`
        INSERT INTO users (name, pass, admin, created_at)
        VALUES (?, ?, 1, datetime('now'))
        RETURNING id
      `).bind(username, password).first<{ id: number }>();

      if (!result) {
        console.error("Failed to insert user into database");
        return null;
      }

      console.log(`Admin user '${username}' created successfully`);
      return result.id;

    } catch (error) {
      console.error("Failed to create admin user:", error);
      return null;
    }
  }

  async hasAdminUser(): Promise<boolean> {
    try {
      // Check if users table exists first
      const tableExists = await this.tableExists('users');
      if (!tableExists) {
        // Table doesn't exist = no admin users (normal state)
        return false;
      }

      const result = await this.db.prepare(`
        SELECT COUNT(*) as count FROM users WHERE admin = 1 AND disabled = 0
      `).first<{ count: number }>();

      return (result?.count || 0) > 0;
    } catch (error) {
      // Only log actual errors
      if (this.isActualError(error)) {
        console.error("Failed to check admin presence:", error);
      }
      return false;
    }
  }

  async getInitStatus(): Promise<{ initialized: boolean; hasAdmin: boolean; canInitialize: boolean }> {
    const initialized = await this.isSystemInitialized();
    const hasAdmin = await this.hasAdminUser();
    return {
      initialized,
      hasAdmin,
      canInitialize: !initialized || !hasAdmin
    };
  }

  /**
   * Get the current initialization status for status endpoint
   */
  async getStatus(): Promise<{ initialized: boolean; canInitialize: boolean; defaultUser?: string }> {
    const initialized = await this.isSystemInitialized();

    // Check if default credentials are configured
    // Note: We can't access env here, so caller should check env vars

    return {
      initialized: initialized,
      canInitialize: !initialized
    };
  }
}
