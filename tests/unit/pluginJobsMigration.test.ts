
















import * as fs from 'fs';
import * as path from 'path';
import type { D1Database } from '@cloudflare/workers-types';
import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { pluginJobs } from '../../src/models/pluginJob';
import { pluginConfigs } from '../../src/models/pluginConfig';
import {
  splitMigrationStatements,
  MigrationRunner,
  MIGRATION_REQUIREMENTS
} from '../../src/services/migrationRunner';
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb';

const MIGRATION_NAME = '0013_plugin_jobs';
const MIGRATIONS_SQL_DIR = path.join(__dirname, '../../src/migrations/sql');
const MIGRATION_SQL = fs.readFileSync(path.join(MIGRATIONS_SQL_DIR, `${MIGRATION_NAME}.sql`), 'utf8');

const EXPECTED_JOB_COLUMNS = [
  'id',
  'user_id',
  'plugin_id',
  'subject_type',
  'subject_id',
  'payload',
  'status',
  'result',
  'last_error_code',
  'last_error_message',
  'created_at',
  'updated_at',
  'completed_at'
];

interface IndexConfig {
  name: string;
  unique: boolean;
  columns: { name: string }[];
  where?: unknown;
}

function indexConfigs(table: unknown): IndexConfig[] {
  const { indexes } = getTableConfig(table as never);
  return indexes.map((idx: unknown) => {
    const config = (idx as { config: IndexConfig & { where?: unknown } }).config;
    return {
      name: config.name,
      unique: config.unique,
      columns: config.columns.map((c: { name: string }) => ({ name: c.name })),
      where: config.where
    };
  });
}

function tableColumns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.pragma(`table_info(${table})`) as unknown as Array<{ name: string }>).map((r) => r.name);
}


function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        async all() {
          return { success: true, meta: {}, results: sqlite.prepare(sql).all() };
        },
        async run() {
          sqlite.prepare(sql).run();
          return { success: true, meta: {}, results: [] };
        },
        bind(...args: unknown[]) {
          return {
            async run() {
              sqlite.prepare(sql).run(...args);
              return { success: true, meta: {}, results: [] };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

function markMigrationApplied(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE \`_migrations\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`name\` text NOT NULL UNIQUE,
      \`applied_at\` text DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite.prepare('INSERT INTO `_migrations` (name) VALUES (?)').run(MIGRATION_NAME);
}


function realMigrationSql(): Record<string, string> {
  const sqlByName: Record<string, string> = {};
  for (const file of fs.readdirSync(MIGRATIONS_SQL_DIR)) {
    if (!file.endsWith('.sql')) continue;
    sqlByName[file.slice(0, -'.sql'.length)] = fs.readFileSync(path.join(MIGRATIONS_SQL_DIR, file), 'utf8');
  }
  return sqlByName;
}





async function installRealMigrations(): Promise<() => void> {
  const { migrations } = await import('../../src/migrations/index.ts');
  const originals = new Map<string, string>();
  for (const [name, sql] of Object.entries(realMigrationSql())) {
    originals.set(name, migrations[name]);
    migrations[name] = sql;
  }
  return () => {
    for (const [name, sql] of originals) migrations[name] = sql;
  };
}

type ColumnInfo = { name: string; notnull: number; dflt_value: string | null };
type IndexInfo = { name: string; unique: number; partial: number };

function columnsInfo(sqlite: Database.Database, table: string): ColumnInfo[] {
  return sqlite.pragma(`table_info(${table})`) as unknown as ColumnInfo[];
}

function indexList(sqlite: Database.Database, table: string): IndexInfo[] {
  return sqlite.pragma(`index_list(${table})`) as unknown as IndexInfo[];
}

function indexColumnOrder(sqlite: Database.Database, name: string): string[] {
  return (sqlite.pragma(`index_info(${name})`) as unknown as Array<{ seqno: number; name: string }>)
    .sort((a, b) => a.seqno - b.seqno)
    .map((row) => row.name);
}

describe('pluginJobs Drizzle schema', () => {
  test('列集与简化版 DDL 完全一致，且不含被否决的列', () => {
    const columns = getTableColumns(pluginJobs);
    const names = Object.values(columns).map((c) => (c as { name: string }).name);
    expect([...names].sort()).toEqual([...EXPECTED_JOB_COLUMNS].sort());


    for (const forbidden of ['processing', 'retry', 'next_retry_at', 'attempt_count', 'lease_token', 'trigger', 'config_version']) {
      expect(names).not.toContain(forbidden);
    }
  });

  test('status 默认 pending，created_at/updated_at 非空且带默认值', () => {
    const columns = getTableColumns(pluginJobs);
    expect(columns.status.default).toBe('pending');
    expect(columns.status.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
    expect(columns.completedAt.notNull).toBe(false);
    expect(columns.payload.notNull).toBe(false);
  });

  test('三个索引名称、唯一性与列顺序与迁移一致', () => {
    const indexes = indexConfigs(pluginJobs);
    expect(indexes.map((i) => i.name).sort()).toEqual([
      'plugin_jobs_active_subject_unique',
      'plugin_jobs_status_created_idx',
      'plugin_jobs_user_subject_idx'
    ]);

    const active = indexes.find((i) => i.name === 'plugin_jobs_active_subject_unique');
    expect(active?.unique).toBe(true);
    expect(active?.columns.map((c) => c.name)).toEqual(['plugin_id', 'subject_type', 'subject_id']);

    expect(active?.where).toBeDefined();

    const statusCreated = indexes.find((i) => i.name === 'plugin_jobs_status_created_idx');
    expect(statusCreated?.unique).toBe(false);
    expect(statusCreated?.columns.map((c) => c.name)).toEqual(['status', 'created_at']);

    const userSubject = indexes.find((i) => i.name === 'plugin_jobs_user_subject_idx');
    expect(userSubject?.unique).toBe(false);
    expect(userSubject?.columns.map((c) => c.name)).toEqual(['user_id', 'subject_type', 'subject_id']);
  });
});

describe('0013_plugin_jobs.sql', () => {
  test('包含建表、三个索引与 plugin_configs 三列', () => {
    expect(MIGRATION_SQL).toContain('CREATE TABLE `plugin_jobs`');
    expect(MIGRATION_SQL).toContain('plugin_jobs_active_subject_unique');
    expect(MIGRATION_SQL).toContain('plugin_jobs_status_created_idx');
    expect(MIGRATION_SQL).toContain('plugin_jobs_user_subject_idx');
    expect(MIGRATION_SQL).toMatch(/ADD `encrypted_secret` text/);
    expect(MIGRATION_SQL).toMatch(/ADD `usage_day` text/);
    expect(MIGRATION_SQL).toMatch(/ADD `usage_count` integer DEFAULT 0 NOT NULL/);
  });

  test('活跃 subject 唯一索引只约束 pending', () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE UNIQUE INDEX `plugin_jobs_active_subject_unique`[\s\S]*WHERE `?status`? = 'pending'/
    );
  });

  test('每段最多一条顶层语句，可被 MigrationRunner 解析为 7 段', () => {
    const statements = splitMigrationStatements(MIGRATION_SQL, MIGRATION_NAME);
    expect(statements).toHaveLength(7);
    expect(statements[0]).toContain('CREATE TABLE `plugin_jobs`');
    expect(statements.filter((s) => s.includes('ALTER TABLE `plugin_configs`'))).toHaveLength(3);
  });

  test('不出现 messages / users / plugin_logs 表标识符（含 UPDATE/DELETE/INSERT/CREATE INDEX）', () => {
    for (const table of ['messages', 'users', 'plugin_logs']) {
      expect(MIGRATION_SQL).not.toMatch(new RegExp(`\\b${table}\\b`));
    }
  });
});

describe('测试 fixture：plugin_jobs / plugin_configs / plugin_logs', () => {
  test('三张表及插件相关索引已建立', () => {
    const { sqlite } = createPluginJobsTestDb();
    const tables = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['plugin_configs', 'plugin_logs', 'plugin_jobs']));

    expect(tableColumns(sqlite, 'plugin_jobs').sort()).toEqual([...EXPECTED_JOB_COLUMNS].sort());

    const indexes = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'plugin_jobs_active_subject_unique',
        'plugin_jobs_status_created_idx',
        'plugin_jobs_user_subject_idx'
      ])
    );
  });

  test('plugin_configs 含 encrypted_secret / usage_day / usage_count，usage_count 默认 0', () => {
    const { sqlite } = createPluginJobsTestDb();
    const columns = tableColumns(sqlite, 'plugin_configs');
    expect(columns).toEqual(expect.arrayContaining(['encrypted_secret', 'usage_day', 'usage_count']));

    sqlite
      .prepare(
        "INSERT INTO `plugin_configs` (`user_id`, `name`, `token`, `module_path`) VALUES (1, 'example task', 't', 'p')"
      )
      .run();
    const row = sqlite.prepare('SELECT `usage_count`, `encrypted_secret`, `usage_day` FROM `plugin_configs`').get() as {
      usage_count: number;
      encrypted_secret: string | null;
      usage_day: string | null;
    };
    expect(row.usage_count).toBe(0);
    expect(row.encrypted_secret).toBeNull();
    expect(row.usage_day).toBeNull();
  });

  test('pending 同 (plugin_id, subject_type, subject_id) 冲突；终态不受唯一约束', () => {
    const { sqlite } = createPluginJobsTestDb();
    const insert = sqlite.prepare(
      'INSERT INTO `plugin_jobs` (`user_id`, `plugin_id`, `subject_type`, `subject_id`, `status`) VALUES (?, ?, ?, ?, ?)'
    );

    insert.run(1, 10, 'message', 100, 'pending');

    let caught: unknown;
    try {
      insert.run(2, 10, 'message', 100, 'pending');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect((caught as { name?: string }).name).toBe('SqliteError');
    expect((caught as Error).message).toContain('UNIQUE constraint failed');
    expect((caught as Error).message).toContain('plugin_jobs.plugin_id');


    expect(() => insert.run(1, 10, 'message', 100, 'success')).not.toThrow();
    expect(() => insert.run(1, 10, 'message', 100, 'failed')).not.toThrow();
    expect(() => insert.run(1, 10, 'message', 100, 'dead')).not.toThrow();
    expect(() => insert.run(2, 11, 'message', 100, 'pending')).not.toThrow();
  });

  test('(status, created_at) 与 (user_id, subject_type, subject_id) 索引写入 sqlite_master', () => {
    const { sqlite } = createPluginJobsTestDb();
    const rows = sqlite
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'plugin_jobs'")
      .all() as Array<{ name: string; sql: string }>;

    const active = rows.find((r) => r.name === 'plugin_jobs_active_subject_unique');
    expect(active).toBeDefined();
    expect(active?.sql).toContain('WHERE status');
    expect(active?.sql).toContain("'pending'");

    const indexColumns = (name: string) =>
      (sqlite.pragma(`index_info(${name})`) as unknown as Array<{ name: string }>).map((r) => r.name);

    expect(indexColumns('plugin_jobs_status_created_idx')).toEqual(['status', 'created_at']);
    expect(indexColumns('plugin_jobs_user_subject_idx')).toEqual(['user_id', 'subject_type', 'subject_id']);
  });
});

describe('MIGRATION_REQUIREMENTS 与真实 schema 校验', () => {


  beforeEach(async () => {
    const { migrations } = await import('../../src/migrations/index.ts');
    migrations[MIGRATION_NAME] = MIGRATION_SQL;
  });

  test('应用 0013 的完整 schema 通过 classifySchema', async () => {
    const { sqlite } = createPluginJobsTestDb();
    markMigrationApplied(sqlite);

    await expect(new MigrationRunner(asD1(sqlite)).classifySchema()).resolves.toBe('healthy');
  });

  test('缺少 0013 列时抛 InconsistentSchemaError 并指出列名', async () => {
    const { sqlite } = createPluginJobsTestDb();
    sqlite.exec('ALTER TABLE `plugin_jobs` DROP COLUMN `completed_at`');
    markMigrationApplied(sqlite);

    await expect(new MigrationRunner(asD1(sqlite)).classifySchema()).rejects.toMatchObject({
      name: 'InconsistentSchemaError',
      code: 'DATABASE_SCHEMA_INCONSISTENT',
      message: expect.stringContaining('plugin_jobs.completed_at')
    });
  });

  test('缺少 0013 索引时抛 InconsistentSchemaError 并指出索引名', async () => {
    const { sqlite } = createPluginJobsTestDb();
    sqlite.exec('DROP INDEX `plugin_jobs_user_subject_idx`');
    markMigrationApplied(sqlite);

    await expect(new MigrationRunner(asD1(sqlite)).classifySchema()).rejects.toMatchObject({
      code: 'DATABASE_SCHEMA_INCONSISTENT',
      message: expect.stringContaining('plugin_jobs_user_subject_idx')
    });
  });
});

describe('真实迁移链执行：空库 → MigrationRunner → 0013 schema', () => {
  let restoreMigrations: () => void;

  beforeAll(async () => {
    restoreMigrations = await installRealMigrations();
  });

  afterAll(() => {
    restoreMigrations();
  });

  test('0000-0013 全链执行后 schema 与 MIGRATION_REQUIREMENTS 逐列逐索引一致', async () => {
    const sqlite = new Database(':memory:');
    try {
      await expect(new MigrationRunner(asD1(sqlite)).runPendingMigrations()).resolves.toBeUndefined();

      const requirement = MIGRATION_REQUIREMENTS[MIGRATION_NAME];
      const requiredJobColumns = requirement.columns!.plugin_jobs;
      const requiredConfigColumns = requirement.columns!.plugin_configs;
      const requiredIndexes = requirement.indexes!;


      const applied = (
        sqlite.prepare('SELECT `name` FROM `_migrations`').all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect([...applied].sort()).toEqual(Object.keys(realMigrationSql()).sort());
      expect(applied).toContain(MIGRATION_NAME);


      expect(requirement.tables).toEqual(['plugin_jobs']);
      expect(columnsInfo(sqlite, 'plugin_jobs').map((column) => column.name)).toEqual(requiredJobColumns);


      const jobIndexes = indexList(sqlite, 'plugin_jobs').filter(
        (index) => !index.name.startsWith('sqlite_autoindex')
      );
      expect(jobIndexes.map((index) => index.name).sort()).toEqual([...requiredIndexes].sort());


      expect(indexColumnOrder(sqlite, 'plugin_jobs_active_subject_unique')).toEqual([
        'plugin_id',
        'subject_type',
        'subject_id'
      ]);
      const active = jobIndexes.find((index) => index.name === 'plugin_jobs_active_subject_unique');
      expect(active?.unique).toBe(1);
      expect(active?.partial).toBe(1);
      const activeSql = sqlite
        .prepare("SELECT `sql` FROM `sqlite_master` WHERE `type` = 'index' AND `name` = ?")
        .get('plugin_jobs_active_subject_unique') as { sql: string };
      expect(activeSql.sql).toMatch(/WHERE\s+`?status`?\s*=\s*'pending'/i);


      expect(indexColumnOrder(sqlite, 'plugin_jobs_status_created_idx')).toEqual(['status', 'created_at']);
      expect(
        jobIndexes.find((index) => index.name === 'plugin_jobs_status_created_idx')?.unique
      ).toBe(0);


      expect(indexColumnOrder(sqlite, 'plugin_jobs_user_subject_idx')).toEqual([
        'user_id',
        'subject_type',
        'subject_id'
      ]);
      expect(jobIndexes.find((index) => index.name === 'plugin_jobs_user_subject_idx')?.unique).toBe(0);


      const configColumns = columnsInfo(sqlite, 'plugin_configs');
      expect(configColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(requiredConfigColumns)
      );
      expect(configColumns.find((column) => column.name === 'usage_count')).toMatchObject({
        notnull: 1,
        dflt_value: '0'
      });


      await expect(new MigrationRunner(asD1(sqlite)).classifySchema()).resolves.toBe('healthy');
    } finally {
      sqlite.close();
    }
  });
});

describe('模型与迁移共用的 plugin_configs 新列', () => {
  test('Drizzle 模型包含三个新列', () => {
    const names = Object.values(getTableColumns(pluginConfigs)).map((c) => (c as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(['encrypted_secret', 'usage_day', 'usage_count']));
  });
});
