import type { D1Database } from "@cloudflare/workers-types";
import { createDrizzle } from "../drizzle/index.ts";
import { users, systemState } from "../models/index.ts";
import { eq, count, sql } from "drizzle-orm";
import { MigrationRunner } from "./migrationRunner.ts";

export interface InitializationResult {
  success: boolean;
  adminUserId?: number;
  error?: string;
}

export class InitService {
  private drizzle;

  constructor(private db: D1Database) {
    this.drizzle = createDrizzle(db);
  }

  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .bind(tableName)
        .first<{ name: string }>();
      return !!result;
    } catch (_) {
      return false;
    }
  }

  async isSystemInitialized(): Promise<boolean> {
    try {
      const exists = await this.tableExists("system_state");
      if (!exists) return false;
      const result = await this.drizzle
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, "is_initialized"))
        .get();
      return !!result && result.value === "true";
    } catch (_) {
      return false;
    }
  }

  async hasAdminUser(): Promise<boolean> {
    try {
      const exists = await this.tableExists("users");
      if (!exists) return false;
      const result = await this.drizzle
        .select({ count: count() })
        .from(users)
        .where(sql`${users.admin} = 1 AND ${users.disabled} = 0`)
        .get();
      return (result?.count || 0) > 0;
    } catch (_) {
      return false;
    }
  }

  async markAsInitialized(): Promise<void> {
    await this.drizzle
      .insert(systemState)
      .values({ key: "is_initialized", value: "true", createdAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .onConflictDoUpdate({ target: systemState.key, set: { value: "true", updatedAt: sql`CURRENT_TIMESTAMP` } });
  }

  async createAdminUser(username: string, password: string): Promise<number | null> {
    const existing = await this.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.name, username))
      .get();
    if (existing) return null;

    const { hashPassword } = await import("../middleware/auth.ts");
    const hashedassword = await hashPassword(password);

    const inserted = await this.drizzle
      .insert(users)
      .values({
        name: username,
        nickname: username,
        email: 'needupdate@crownkin.space',
        pass: hashedassword,
        admin: true,
        disabled: false,
        createdAt: sql`CURRENT_TIMESTAMP`
      })
      .returning({ id: users.id });
    return inserted && inserted.length > 0 ? inserted[0].id : null;
  }

  async getInitStatus(): Promise<{ initialized: boolean; hasAdmin: boolean; canInitialize: boolean }> {
    const initialized = await this.isSystemInitialized();
    const hasAdmin = await this.hasAdminUser();
    return { initialized, hasAdmin, canInitialize: !initialized || !hasAdmin };
  }

  async ensureSchema(): Promise<void> {
    const migrationRunner = new MigrationRunner(this.db);
    await migrationRunner.runPendingMigrations();
  }

  async validateDatabase(): Promise<boolean> {
    try {
      await this.db.prepare("SELECT 1 as test").first();
      const requiredTables = ['users', 'applications', 'clients', 'messages', 'system_state'];
      for (const table of requiredTables) {
        const exists = await this.tableExists(table);
        if (!exists) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}

