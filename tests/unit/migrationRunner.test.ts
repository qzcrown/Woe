







import { MigrationRunner, splitMigrationStatements } from "../../src/services/migrationRunner";
import * as fs from "fs";
import * as path from "path";

function makeDb(statementBehaviors: Array<(sql: string) => { run: () => Promise<any> } | null>) {
  let call = 0;
  const preparedSqls: string[] = [];
  const bindArgs: any[] = [];
  const db: any = {
    prepare: jest.fn((sql: string) => {
      preparedSqls.push(sql);
      const behavior =
        statementBehaviors[Math.min(call, statementBehaviors.length - 1)]?.(sql) ??
        { run: jest.fn().mockResolvedValue({}) };
      call++;
      return {
        run: behavior.run,
        all: jest.fn().mockResolvedValue({ results: [] }),
        first: jest.fn().mockResolvedValue(null),
        bind: jest.fn((...args: any[]) => {
          bindArgs.push(args);
          return { run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        }),
      };
    }),
  };
  return { db, preparedSqls, bindArgs };
}

function makeSchemaDb(options: {
  tables: string[];
  indexes?: string[];
  columns?: Record<string, string[]>;
  applied?: string[];
}) {
  const preparedSqls: string[] = [];
  const tableSet = new Set(options.tables);
  const indexSet = new Set(options.indexes || []);
  const columns = options.columns || {};
  const applied = options.applied || [];
  const boundArgs: unknown[][] = [];
  const db: any = {
    prepare: jest.fn((sql: string) => {
      preparedSqls.push(sql);
      if (sql.includes("SELECT type, name FROM sqlite_master")) {
        return {
          all: jest.fn().mockResolvedValue({
            results: [
              ...[...tableSet].map((name) => ({ type: "table", name })),
              ...[...indexSet].map((name) => ({ type: "index", name })),
            ],
          }),
        };
      }
      if (sql.startsWith("PRAGMA table_info")) {
        const table = sql.match(/`([^`]+)`/)?.[1] || "";
        return { all: jest.fn().mockResolvedValue({ results: (columns[table] || []).map((name) => ({ name })) }) };
      }
      if (sql.includes("SELECT name FROM _migrations")) {
        return { all: jest.fn().mockResolvedValue({ results: applied.map((name) => ({ name })) }) };
      }
      return {
        run: jest.fn().mockResolvedValue({}),
        all: jest.fn().mockResolvedValue({ results: [] }),
        bind: jest.fn((...args: unknown[]) => {
          boundArgs.push(args);
          return { run: jest.fn().mockResolvedValue({}) };
        }),
      };
    }),
  };
  return { db, preparedSqls, boundArgs };
}

describe("executeSqlStatements 容错", () => {
  test("拒绝显式断点分段中的多条顶层 SQL，并报告迁移名与行号", async () => {
    const { db } = makeDb([]);
    const runner = new MigrationRunner(db);

    await expect(
      (runner as any).executeSqlStatements("SELECT 1;\nSELECT 2;", "0007_application_sort_key")
    ).rejects.toThrow(/Migration 0007_application_sort_key.*line 2/);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  test("多语句断点错误的行号使用迁移文件全局行号", () => {
    expect(() => splitMigrationStatements(
      "SELECT 1;--> statement-breakpoint\n\nSELECT 2; SELECT 3;",
      "fixture"
    )).toThrow(/fixture.*line 3/);
  });

  test("分号出现在字符串和注释中时不误判为多语句", () => {
    expect(
      splitMigrationStatements(
        "-- comment;\nSELECT 'value;still one'; /* block; */",
        "fixture"
      )
    ).toHaveLength(1);
  });

  test("duplicate column name 错误被容忍：跳过该语句、继续执行后续语句", async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error("duplicate column name: sort_key"));
    const { db, preparedSqls } = makeDb([
      (sql) => (sql.includes("ALTER TABLE") ? { run } : null),
    ]);
    const runner = new MigrationRunner(db);

    await expect(
      (runner as any).executeSqlStatements(
        "ALTER TABLE `applications` ADD `sort_key` text;--> statement-breakpoint\nCREATE INDEX idx_x ON t(c);"
      )
    ).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(1);
    expect(preparedSqls.filter((sql) => sql.includes("CREATE INDEX")).length).toBe(1);
  });

  test("非容错错误（语法错误）向上抛出", async () => {
    const { db } = makeDb([
      () => ({ run: jest.fn().mockRejectedValue(new Error('near "FROM": syntax error')) }),
    ]);
    const runner = new MigrationRunner(db);

    await expect(
      (runner as any).executeSqlStatements("SELECT FROM broken;")
    ).rejects.toThrow('syntax error');
  });

  test("no such table/index 不被 SQLITE_ERROR 宽泛规则吞掉", async () => {
    for (const message of [
      "SQLITE_ERROR: no such table: missing_table",
      "SQLITE_ERROR: no such index: missing_index",
      "SQLITE_ERROR: UNIQUE constraint failed: users.name",
    ]) {
      const { db } = makeDb([
        () => ({ run: jest.fn().mockRejectedValue(new Error(message)) }),
      ]);
      const runner = new MigrationRunner(db);

      await expect(
        (runner as any).executeSqlStatements("CREATE TABLE missing_table (id INTEGER);")
      ).rejects.toThrow(message);
    }
  });

  test("_migrations 读取失败向上抛出，不当作空集合重放", async () => {
    const db: any = {
      prepare: jest.fn((sql: string) => ({
        run: jest.fn().mockResolvedValue({}),
        all: jest.fn().mockRejectedValue(new Error("D1 unavailable")),
        bind: jest.fn(() => ({ run: jest.fn().mockResolvedValue({}) })),
      })),
    };
    const runner = new MigrationRunner(db);

    await expect((runner as any).getAppliedMigrations()).rejects.toThrow("D1 unavailable");
  });

  test("迁移语句失败时不写入该迁移的 _migrations 记录", async () => {
    const { migrations } = await import("../../src/migrations/index.ts");
    const original = migrations["0001_conscious_karen_page"];
    migrations["0001_conscious_karen_page"] = fs.readFileSync(
      path.join(__dirname, "../../src/migrations/sql/0001_conscious_karen_page.sql"),
      "utf8"
    );
    const { db, bindArgs } = makeDb([
      (sql) => sql.includes("ADD `nickname`")
        ? { run: jest.fn().mockRejectedValue(new Error("no such table: users")) }
        : null,
    ]);
    try {
      await expect(new MigrationRunner(db).runPendingMigrations()).rejects.toThrow("no such table: users");
      expect(bindArgs.flat()).not.toContain("0001_conscious_karen_page");
    } finally {
      migrations["0001_conscious_karen_page"] = original;
    }
  });
});

describe("数据库状态分类与固定基线", () => {
  const coreTables = ["users", "applications", "clients", "messages", "plugin_configs", "plugin_logs", "system_state"];

  test("空库（包括仅有空 _migrations）识别为 fresh", async () => {
    const { db } = makeSchemaDb({ tables: ["_migrations"], applied: [] });
    await expect(new MigrationRunner(db).classifySchema()).resolves.toBe("fresh");
  });

  test("完整基础表识别为 healthy，缺少 0000 时允许采用基线", async () => {
    const { db } = makeSchemaDb({ tables: coreTables, applied: [] });
    await expect(new MigrationRunner(db).classifySchema()).resolves.toBe("healthy");
  });

  test("部分基础表或有迁移记录但无基础表识别为 inconsistent", async () => {
    const partial = makeSchemaDb({ tables: ["users"], applied: [] });
    await expect(new MigrationRunner(partial.db).classifySchema()).rejects.toMatchObject({
      code: "DATABASE_SCHEMA_INCONSISTENT",
    });

    const recorded = makeSchemaDb({ tables: ["_migrations"], applied: ["0001_conscious_karen_page"] });
    await expect(new MigrationRunner(recorded.db).classifySchema()).rejects.toMatchObject({
      code: "DATABASE_SCHEMA_INCONSISTENT",
    });
  });

  test("已记录迁移但关键对象缺失时拒绝继续", async () => {
    const { db } = makeSchemaDb({
      tables: [...coreTables, "_migrations"],
      applied: ["0000_initial_schema", "0006_lone_atom"],
      columns: {},
    });
    await expect(new MigrationRunner(db).classifySchema()).rejects.toMatchObject({
      code: "DATABASE_SCHEMA_INCONSISTENT",
    });
  });

  test("fresh 执行时先运行 0000，再记录基线迁移", async () => {
    const { db, preparedSqls, boundArgs } = makeSchemaDb({ tables: [], applied: [] });
    const { migrations } = await import("../../src/migrations/index.ts");
    const original = migrations["0000_initial_schema"];
    migrations["0000_initial_schema"] = fs.readFileSync(
      path.join(__dirname, "../../src/migrations/sql/0000_initial_schema.sql"),
      "utf8"
    );
    try {
      await expect(new MigrationRunner(db).runPendingMigrations()).resolves.toBeUndefined();
      expect(preparedSqls.some((sql) => sql.includes("CREATE TABLE `applications`"))).toBe(true);
      expect(preparedSqls.some((sql) => sql.includes("INSERT INTO _migrations"))).toBe(true);
      expect(boundArgs.flat()).toContain("0000_initial_schema");
    } finally {
      migrations["0000_initial_schema"] = original;
    }
  });
});

describe("runPendingMigrations 端到端（真实迁移索引 + 注入重复列错误）", () => {
  test("首条 ALTER 撞重复列仍被容忍，全部迁移被记录", async () => {
    let duplicateInjected = false;
    const { db, preparedSqls, bindArgs } = makeDb([
      (sql) => {
        if (!duplicateInjected && sql.trimStart().startsWith("ALTER")) {
          duplicateInjected = true;
          return { run: jest.fn().mockRejectedValue(new Error("duplicate column name: nickname")) };
        }
        return null;
      },
    ]);

    await expect(new MigrationRunner(db).runPendingMigrations()).resolves.toBeUndefined();

    const { migrations } = await import("../../src/migrations/index.ts");
    const inserts = preparedSqls.filter((s) => s.includes("INSERT INTO _migrations"));
    expect(inserts.length).toBe(Object.keys(migrations).length);
    expect(bindArgs.flat()).toContain("0008_client_elevated_until");
  });
});

describe("runPendingMigrations 端到端（0009 索引重建撞 already exists）", () => {





  const MIGRATION_0009 = "0009_unusual_human_cannonball";
  const isClientsUniqueIndex = (sql: string) =>
    sql.includes("CREATE UNIQUE INDEX") && sql.includes("clients_user_id_device_uid_unique");


  async function withReal0009<T>(fn: () => Promise<T>): Promise<T> {
    const { migrations } = await import("../../src/migrations/index.ts");
    const original = migrations[MIGRATION_0009];
    const real = fs.readFileSync(
      path.join(__dirname, "../../src/migrations/sql/0009_unusual_human_cannonball.sql"),
      "utf8"
    );

    if (!real.split("--> statement-breakpoint").some((s) => isClientsUniqueIndex(s))) {
      throw new Error("0009 no longer contains the clients unique index statement under test");
    }
    migrations[MIGRATION_0009] = real;
    try {
      return await fn();
    } finally {
      migrations[MIGRATION_0009] = original;
    }
  }

  test("CREATE UNIQUE INDEX already exists 被容忍：跳过该语句、后续语句执行、迁移照常记录", async () => {
    const indexRun = jest
      .fn()
      .mockRejectedValue(new Error("index clients_user_id_device_uid_unique already exists"));
    const { db, preparedSqls, bindArgs } = makeDb([
      (sql) => (isClientsUniqueIndex(sql) ? { run: indexRun } : null),
    ]);

    await withReal0009(() =>
      expect(new MigrationRunner(db).runPendingMigrations()).resolves.toBeUndefined()
    );


    expect(indexRun).toHaveBeenCalledTimes(1);

    expect(preparedSqls.filter((s) => s.includes("push_outbox_status_next_retry_idx")).length).toBe(1);

    const { migrations } = await import("../../src/migrations/index.ts");
    const inserts = preparedSqls.filter((s) => s.includes("INSERT INTO _migrations"));
    expect(inserts.length).toBe(Object.keys(migrations).length);
    expect(bindArgs.flat()).toContain("0009_unusual_human_cannonball");
  });

  test("UNIQUE constraint failed（数据冲突）不被容忍：向上抛出", async () => {
    const { db } = makeDb([
      (sql) =>
        isClientsUniqueIndex(sql)
          ? { run: jest.fn().mockRejectedValue(new Error("UNIQUE constraint failed: clients.user_id, clients.device_uid")) }
          : null,
    ]);

    await withReal0009(() =>
      expect(new MigrationRunner(db).runPendingMigrations()).rejects.toThrow(
        "UNIQUE constraint failed: clients.user_id, clients.device_uid"
      )
    );
  });
});

describe("迁移索引完整性（固定 0000 基线与单一 0007）", () => {
  test("无 0007_big_fabian_cortez、含 0008-0012、键唯一", async () => {
    const { migrations } = await import("../../src/migrations/index.ts");
    const keys = Object.keys(migrations);
    expect(keys).not.toContain("0007_big_fabian_cortez");
    expect(keys).toContain("0000_initial_schema");
    expect(keys).toContain("0007_application_sort_key");
    expect(keys).toContain("0008_client_elevated_until");
    expect(keys).toContain("0009_unusual_human_cannonball");
    expect(keys).toContain("0010_same_firestar");
    expect(keys).toContain("0011_active_device_token_unique");

    expect(keys).toContain("0012_wonderful_random");

    expect(keys).toContain("0013_plugin_jobs");
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(14);
  });

  test("0001 末尾 UPDATE 与 0007 三条 SQL 都按断点分隔", () => {
    const migration0001 = fs.readFileSync(
      path.join(__dirname, "../../src/migrations/sql/0001_conscious_karen_page.sql"),
      "utf8"
    );
    const migration0007 = fs.readFileSync(
      path.join(__dirname, "../../src/migrations/sql/0007_application_sort_key.sql"),
      "utf8"
    );

    expect(splitMigrationStatements(migration0001, "0001_conscious_karen_page")).toHaveLength(5);
    expect(splitMigrationStatements(migration0001, "0001_conscious_karen_page").at(-1)).toContain("UPDATE `users`");
    expect(splitMigrationStatements(migration0007, "0007_application_sort_key")).toHaveLength(3);
  });

  test("所有已入索引迁移的每个 prepare 分段最多一条顶层 SQL", async () => {
    const { migrations } = await import("../../src/migrations/index.ts");
    for (const [name, sql] of Object.entries(migrations)) {
      expect(() => splitMigrationStatements(sql, name)).not.toThrow();
    }
  });
});
