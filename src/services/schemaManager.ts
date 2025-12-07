import type { D1Database } from "@cloudflare/workers-types";
import { schemaDefinitions, createTableSQL, createIndexSQL, TableDef } from "../schema/definitions.ts";

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder();
  // @ts-ignore - Workers have crypto.subtle
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(text));
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

export class SchemaManager {
  constructor(private db: D1Database) {}

  async computeSchemaHash(): Promise<string> {
    const payload = stableStringify(schemaDefinitions);
    return await sha256(payload);
  }

  private async getSystemState(key: string): Promise<string | null> {
    try {
      const row = await this.db.prepare("SELECT value FROM system_state WHERE key = ?").bind(key).first<{ value: string }>();
      return row?.value ?? null;
    } catch (_) {
      return null;
    }
  }

  private async setSystemState(key: string, value: string): Promise<void> {
    await this.db.prepare("CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
    await this.db.prepare("INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").bind(key, value).run();
  }

  private async listExistingTables(names: string[]): Promise<Set<string>> {
    const placeholders = names.map(() => "?").join(",");
    const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`;
    const res = await this.db.prepare(sql).bind(...names).all<{ name: string }>();
    const set = new Set<string>();
    for (const r of (res.results || [])) set.add((r as any).name);
    return set;
  }

  private async ensureTable(def: TableDef): Promise<void> {
    await this.db.prepare(createTableSQL(def)).run();
    for (const idx of def.indexes || []) {
      await this.db.prepare(createIndexSQL(def, idx)).run();
    }
  }

  private async ensureColumns(def: TableDef): Promise<void> {
    const res = await this.db.prepare(`PRAGMA table_info('${def.name}')`).all();
    const existingCols = new Set<string>(((res as any).results || []).map((r: any) => r.name));
    for (const c of def.columns) {
      if (!existingCols.has(c.name)) {
        const parts: string[] = [c.name, c.type];
        if (c.notNull) parts.push("NOT NULL");
        if (c.default !== undefined) {
          if (typeof c.default === "string" && c.default.toUpperCase() === "CURRENT_TIMESTAMP") parts.push("DEFAULT CURRENT_TIMESTAMP");
          else if (typeof c.default === "boolean") parts.push(`DEFAULT ${c.default ? 1 : 0}`);
          else parts.push(`DEFAULT ${c.default}`);
        }
        // Avoid adding PK/UNIQUE on ALTER; SQLite cannot add these constraints later easily
        const sql = `ALTER TABLE ${def.name} ADD COLUMN ${parts.join(' ')}`;
        await this.db.prepare(sql).run();
      }
    }
    for (const idx of def.indexes || []) {
      await this.db.prepare(createIndexSQL(def, idx)).run();
    }
  }

  async ensureUpToDate(): Promise<void> {
    const desiredHash = await this.computeSchemaHash();
    const currentHash = await this.getSystemState("schema_hash");
    if (currentHash === desiredHash) return;

    const tableNames = schemaDefinitions.map(d => d.name);
    const existing = await this.listExistingTables(tableNames);

    for (const def of schemaDefinitions) {
      if (!existing.has(def.name)) await this.ensureTable(def);
      else await this.ensureColumns(def);
    }

    await this.setSystemState("schema_hash", desiredHash);
  }
}

