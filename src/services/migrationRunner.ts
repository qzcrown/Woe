import type { D1Database } from "@cloudflare/workers-types";
import { migrations } from "../migrations/index.ts";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export type DatabaseSchemaState = "fresh" | "healthy" | "inconsistent";

export class InconsistentSchemaError extends Error {
  readonly code = "DATABASE_SCHEMA_INCONSISTENT";

  constructor(message: string) {
    super(message);
    this.name = "InconsistentSchemaError";
  }
}

const CORE_BASELINE_TABLES = [
  "users",
  "applications",
  "clients",
  "messages",
  "plugin_configs",
  "plugin_logs",
  "system_state",
] as const;

export const MIGRATION_REQUIREMENTS: Record<string, {
  tables?: string[];
  indexes?: string[];
  columns?: Record<string, string[]>;
}> = {
  "0000_initial_schema": {
    tables: [...CORE_BASELINE_TABLES, "_migrations"],
    indexes: [
      "applications_token_unique",
      "clients_token_unique",
      "users_name_unique",
    ],
  },
  "0001_conscious_karen_page": {
    columns: { users: ["nickname", "email", "avatar", "description"] },
  },
  "0002_light_spectrum": {
    tables: ["user_plugin_permissions"],
    indexes: ["user_plugin_permissions_user_id_module_path_unique"],
  },
  "0003_steady_ted_forrester": { columns: { plugin_configs: ["icon"] } },
  "0004_gorgeous_kang": {
    columns: { clients: ["device_id", "device_type", "push_token", "push_platform", "push_token_updated_at"] },
    indexes: ["clients_user_id_device_id_idx", "clients_push_platform_idx"],
  },
  "0006_lone_atom": {
    tables: ["push_outbox"],
    columns: { clients: ["platform", "device_uid", "device_token", "token_updated_at", "token_status", "app_version", "device_model"] },
    indexes: ["clients_user_id_device_uid_unique", "push_outbox_status_next_retry_idx", "push_outbox_user_platform_status_idx"],
  },
  "0007_application_sort_key": {
    columns: { applications: ["sort_key"] },
    indexes: ["idx_applications_user_sort_key"],
  },
  "0008_client_elevated_until": { columns: { clients: ["elevated_until"] } },
  "0009_unusual_human_cannonball": {
    indexes: [
      "idx_applications_user_sort_key",
      "clients_user_id_device_uid_unique",
      "push_outbox_status_next_retry_idx",
      "push_outbox_user_platform_status_idx",
    ],
  },
  "0010_same_firestar": { indexes: ["push_outbox_client_message_unique"] },
  "0011_active_device_token_unique": { indexes: ["clients_active_device_token_unique"] },
  "0012_wonderful_random": {
    columns: { clients: ["expires_after_inactivity_seconds", "expires_at"] },
    indexes: ["clients_expires_at_idx"],
  },
  "0013_plugin_jobs": {
    tables: ["plugin_jobs"],
    columns: {
      plugin_jobs: [
        "id",
        "user_id",
        "plugin_id",
        "subject_type",
        "subject_id",
        "payload",
        "status",
        "result",
        "last_error_code",
        "last_error_message",
        "created_at",
        "updated_at",
        "completed_at",
      ],
      plugin_configs: ["encrypted_secret", "usage_day", "usage_count"],
    },
    indexes: [
      "plugin_jobs_active_subject_unique",
      "plugin_jobs_status_created_idx",
      "plugin_jobs_user_subject_idx",
    ],
  },
};

type SchemaSnapshot = {
  tables: Set<string>;
  indexes: Set<string>;
  columns: Map<string, Set<string>>;
  applied: Set<string>;
};

type SqlScanResult = {
  topLevelSemicolonPositions: number[];
  hasSqlToken: boolean;
};





function scanSqlSegment(segment: string): SqlScanResult {
  const semicolons: number[] = [];
  let hasSqlToken = false;
  let quote: "'" | '"' | "`" | "[" | null = null;
  let i = 0;

  while (i < segment.length) {
    const char = segment[i];
    const next = segment[i + 1];

    if (quote) {
      hasSqlToken = true;
      if (quote === "[") {
        if (char === "]") quote = null;
        i += 1;
        continue;
      }
      if (char === quote) {

        if (segment[i + 1] === quote) {
          i += 2;
          continue;
        }
        quote = null;
      }
      i += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = segment.indexOf("\n", i + 2);
      i = newline === -1 ? segment.length : newline + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = segment.indexOf("*/", i + 2);
      i = end === -1 ? segment.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      hasSqlToken = true;
      i += 1;
      continue;
    }
    if (char === "[") {
      quote = "[";
      hasSqlToken = true;
      i += 1;
      continue;
    }
    if (char === ";") {
      semicolons.push(i);
      i += 1;
      continue;
    }
    if (!/\s/.test(char)) hasSqlToken = true;
    i += 1;
  }

  return { topLevelSemicolonPositions: semicolons, hasSqlToken };
}

function lineNumberAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}





export function splitMigrationStatements(sql: string, migrationName = "unknown"): string[] {
  const statements: string[] = [];
  let segmentOffset = 0;

  for (const segment of sql.split(STATEMENT_BREAKPOINT)) {
    const scan = scanSqlSegment(segment);
    if (scan.topLevelSemicolonPositions.length > 1) {
      const secondSemicolon = scan.topLevelSemicolonPositions[1];
      throw new Error(
        `Migration ${migrationName} contains multiple top-level SQL statements near line ${lineNumberAt(sql, segmentOffset + secondSemicolon)}`
      );
    }
    if (scan.hasSqlToken) {
      statements.push(segment.trim());
    }
    segmentOffset += segment.length + STATEMENT_BREAKPOINT.length;
  }

  return statements;
}

export class MigrationRunner {
  constructor(private db: D1Database) {}




  private async ensureMigrationTable(): Promise<void> {
    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  }




  private async getAppliedMigrations(): Promise<Set<string>> {
    const result = await this.db
      .prepare("SELECT name FROM _migrations")
      .all<{ name: string }>();

    return new Set((result.results || []).map(r => r.name));
  }

  private async readSchemaSnapshot(): Promise<SchemaSnapshot> {
    const result = await this.db
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')")
      .all<{ type: string; name: string }>();
    const objects = result.results || [];
    const tables = new Set(objects.filter((item) => item.type === "table").map((item) => item.name));
    const indexes = new Set(objects.filter((item) => item.type === "index").map((item) => item.name));
    const columns = new Map<string, Set<string>>();
    const columnTables = new Set<string>([
      ...CORE_BASELINE_TABLES,
      ...Object.values(MIGRATION_REQUIREMENTS).flatMap((requirement) => Object.keys(requirement.columns || {})),
    ]);

    for (const table of columnTables) {
      if (!tables.has(table)) continue;
      const columnResult = await this.db
        .prepare(`PRAGMA table_info(\`${table}\`)`)
        .all<{ name: string }>();
      columns.set(table, new Set((columnResult.results || []).map((column) => column.name)));
    }

    const applied = tables.has("_migrations")
      ? await this.getAppliedMigrations()
      : new Set<string>();
    return { tables, indexes, columns, applied };
  }

  private schemaState(snapshot: SchemaSnapshot): DatabaseSchemaState {
    const presentCoreTables = CORE_BASELINE_TABLES.filter((table) => snapshot.tables.has(table)).length;
    if (presentCoreTables === 0 && snapshot.applied.size === 0) return "fresh";
    if (presentCoreTables === CORE_BASELINE_TABLES.length) return "healthy";
    return "inconsistent";
  }

  private assertAppliedSchemaIsComplete(snapshot: SchemaSnapshot): void {
    const unknownMigrations = [...snapshot.applied].filter((name) => !migrations[name]);
    if (unknownMigrations.length > 0) {
      throw new InconsistentSchemaError(
        `Database contains unknown migration records: ${unknownMigrations.join(", ")}`
      );
    }

    for (const migrationName of snapshot.applied) {
      let requirement: (typeof MIGRATION_REQUIREMENTS)[string] | undefined = MIGRATION_REQUIREMENTS[migrationName];



      if (migrationName === "0004_gorgeous_kang" && snapshot.applied.has("0005_free_siren")) {
        requirement = undefined;
      }
      if (!requirement) continue;
      const missingTables = (requirement.tables || []).filter((table) => !snapshot.tables.has(table));
      const missingIndexes = (requirement.indexes || []).filter((index) => !snapshot.indexes.has(index));
      const missingColumns: string[] = [];
      for (const [table, columns] of Object.entries(requirement.columns || {})) {
        const actual = snapshot.columns.get(table) || new Set<string>();
        for (const column of columns) {
          if (!actual.has(column)) missingColumns.push(`${table}.${column}`);
        }
      }
      if (missingTables.length || missingIndexes.length || missingColumns.length) {
        const details = [
          missingTables.length ? `tables=${missingTables.join(",")}` : "",
          missingIndexes.length ? `indexes=${missingIndexes.join(",")}` : "",
          missingColumns.length ? `columns=${missingColumns.join(",")}` : "",
        ].filter(Boolean).join("; ");
        throw new InconsistentSchemaError(
          `Database schema is inconsistent for migration ${migrationName}: ${details}`
        );
      }
    }
  }


  async classifySchema(): Promise<DatabaseSchemaState> {
    const snapshot = await this.readSchemaSnapshot();
    const state = this.schemaState(snapshot);
    if (state === "inconsistent") {
      throw new InconsistentSchemaError("Database schema is partially initialized");
    }
    this.assertAppliedSchemaIsComplete(snapshot);
    return state;
  }





  private isIgnorableMigrationConflict(error: unknown): boolean {
    const errorMessage = error instanceof Error
      ? error.message
      : String(error ?? "");
    return /already exists|duplicate column name/i.test(errorMessage);
  }




  private async recordMigration(name: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, CURRENT_TIMESTAMP)")
      .bind(name)
      .run();
  }





  private async executeSqlStatements(sql: string, migrationName = "unknown"): Promise<void> {
    const statements = splitMigrationStatements(sql, migrationName);

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await this.db.prepare(statement).run();
        } catch (error: unknown) {


          if (this.isIgnorableMigrationConflict(error)) {
            console.log(`[Migration] Object already exists, skipping: ${statement.split('\n')[0].substring(0, 50)}...`);
            continue;
          }
          throw error;
        }
      }
    }
  }




  async runPendingMigrations(): Promise<void> {
    const snapshot = await this.readSchemaSnapshot();
    const state = this.schemaState(snapshot);
    if (state === "inconsistent") {
      throw new InconsistentSchemaError("Database schema is partially initialized");
    }
    this.assertAppliedSchemaIsComplete(snapshot);

    let appliedMigrations = new Set(snapshot.applied);
    if (state === "fresh") {
      await this.executeSqlStatements(migrations["0000_initial_schema"], "0000_initial_schema");
      await this.ensureMigrationTable();
      await this.recordMigration("0000_initial_schema");
      appliedMigrations.add("0000_initial_schema");
    } else {
      await this.ensureMigrationTable();
      appliedMigrations = await this.getAppliedMigrations();
      if (!appliedMigrations.has("0000_initial_schema")) {

        await this.recordMigration("0000_initial_schema");
        appliedMigrations.add("0000_initial_schema");
      }
    }

    const sortedMigrationNames = Object.keys(migrations).sort();

    for (const migrationName of sortedMigrationNames) {
      if (!appliedMigrations.has(migrationName)) {
        console.log(`Running migration: ${migrationName}`);

        try {
          const sqlContent = migrations[migrationName];
          await this.executeSqlStatements(sqlContent, migrationName);
          await this.recordMigration(migrationName);

          console.log(`Migration completed: ${migrationName}`);
        } catch (error) {
          console.error(`Migration failed: ${migrationName}`, error);
          throw error;
        }
      }
    }
  }




  async getMigrationStatus(): Promise<{
    total: number;
    applied: number;
    pending: string[];
  }> {
    const snapshot = await this.readSchemaSnapshot();
    const state = this.schemaState(snapshot);
    if (state === "inconsistent") {
      throw new InconsistentSchemaError("Database schema is partially initialized");
    }
    this.assertAppliedSchemaIsComplete(snapshot);
    const appliedMigrations = new Set(snapshot.applied);
    if (state === "healthy" && !appliedMigrations.has("0000_initial_schema")) {
      appliedMigrations.add("0000_initial_schema");
    }
    const allMigrations = Object.keys(migrations).sort();
    const pending = allMigrations.filter(name => !appliedMigrations.has(name));

    return {
      total: allMigrations.length,
      applied: appliedMigrations.size,
      pending,
    };
  }
}
