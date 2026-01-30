import type { D1Database } from "@cloudflare/workers-types";
import { migrations } from "../migrations/index.ts";

export class MigrationRunner {
  constructor(private db: D1Database) {}

  /**
   * 确保迁移记录表存在
   */
  private async ensureMigrationTable(): Promise<void> {
    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  }

  /**
   * 获取已执行的迁移列表
   */
  private async getAppliedMigrations(): Promise<Set<string>> {
    try {
      const result = await this.db
        .prepare("SELECT name FROM _migrations")
        .all<{ name: string }>();
      
      return new Set((result.results || []).map(r => r.name));
    } catch (error) {
      // 如果表不存在，返回空集合
      return new Set();
    }
  }

  /**
   * 记录已执行的迁移
   */
  private async recordMigration(name: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, CURRENT_TIMESTAMP)")
      .bind(name)
      .run();
  }

  /**
   * 拆分 SQL 语句并执行
   * drizzle-kit 生成的 SQL 使用 `--> statement-breakpoint` 作为分隔符
   */
  private async executeSqlStatements(sql: string): Promise<void> {
    // 使用 statement-breakpoint 分割语句
    const statements = sql
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await this.db.prepare(statement).run();
        } catch (error: any) {
          const errorMessage = error.message || "";
          // 容忍表或索引已存在的错误
          if (
            errorMessage.includes("already exists") || 
            errorMessage.includes("SQLITE_ERROR") && (errorMessage.includes("table") || errorMessage.includes("index"))
          ) {
            console.log(`[Migration] Object already exists, skipping: ${statement.split('\n')[0].substring(0, 50)}...`);
            continue;
          }
          throw error;
        }
      }
    }
  }

  /**
   * 运行所有待执行的迁移
   */
  async runPendingMigrations(): Promise<void> {
    // 1. 确保迁移记录表存在
    await this.ensureMigrationTable();

    // 2. 获取已执行的迁移
    const appliedMigrations = await this.getAppliedMigrations();

    // 3. 按名称排序所有迁移（确保顺序执行）
    const sortedMigrationNames = Object.keys(migrations).sort();

    // 4. 执行未执行的迁移
    for (const migrationName of sortedMigrationNames) {
      if (!appliedMigrations.has(migrationName)) {
        console.log(`Running migration: ${migrationName}`);
        
        try {
          const sqlContent = migrations[migrationName];
          await this.executeSqlStatements(sqlContent);
          await this.recordMigration(migrationName);
          
          console.log(`Migration completed: ${migrationName}`);
        } catch (error) {
          console.error(`Migration failed: ${migrationName}`, error);
          throw error;
        }
      }
    }
  }

  /**
   * 获取迁移状态
   */
  async getMigrationStatus(): Promise<{
    total: number;
    applied: number;
    pending: string[];
  }> {
    await this.ensureMigrationTable();
    const appliedMigrations = await this.getAppliedMigrations();
    const allMigrations = Object.keys(migrations).sort();
    const pending = allMigrations.filter(name => !appliedMigrations.has(name));

    return {
      total: allMigrations.length,
      applied: appliedMigrations.size,
      pending,
    };
  }
}
