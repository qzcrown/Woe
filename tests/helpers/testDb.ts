




















import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleDB } from '../../src/drizzle/index.ts';
import * as schema from '../../src/models';






const BASELINE_SCHEMA_SQL = `
CREATE TABLE \`users\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
		\`name\` text NOT NULL UNIQUE,
	\`admin\` integer DEFAULT 0 NOT NULL,
	\`disabled\` integer DEFAULT 0 NOT NULL
);
CREATE TABLE \`clients\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL,
	\`token\` text NOT NULL,
	\`name\` text NOT NULL,
	\`platform\` text DEFAULT 'unknown' NOT NULL,
	\`device_uid\` text,
	\`device_token\` text,
	\`token_updated_at\` text,
	\`token_status\` text DEFAULT 'active' NOT NULL,
	\`app_version\` text,
	\`device_model\` text,
	\`last_used\` text,
	\`elevated_until\` text,
		\`expires_after_inactivity_seconds\` integer DEFAULT 0 NOT NULL,
	\`expires_at\` text,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX \`clients_token_unique\` ON \`clients\` (\`token\`);
CREATE INDEX \`clients_expires_at_idx\` ON \`clients\` (\`expires_at\`);
CREATE UNIQUE INDEX \`clients_user_id_device_uid_unique\` ON \`clients\` (\`user_id\`,\`device_uid\`);
CREATE UNIQUE INDEX \`clients_active_device_token_unique\` ON \`clients\` (\`device_token\`)
  WHERE device_token IS NOT NULL AND device_token != '' AND token_status = 'active';
CREATE TABLE \`push_outbox\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL,
	\`message_id\` integer NOT NULL,
	\`platform\` text NOT NULL,
	\`client_id\` integer,
	\`payload_json\` text NOT NULL,
	\`status\` text DEFAULT 'pending' NOT NULL,
	\`attempt_count\` integer DEFAULT 0 NOT NULL,
	\`next_retry_at\` text,
	\`last_error\` text,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP,
	\`updated_at\` text DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX \`push_outbox_status_next_retry_idx\` ON \`push_outbox\` (\`status\`,\`next_retry_at\`);
CREATE INDEX \`push_outbox_user_platform_status_idx\` ON \`push_outbox\` (\`user_id\`,\`platform\`,\`status\`);
CREATE UNIQUE INDEX \`push_outbox_client_message_unique\` ON \`push_outbox\` (\`client_id\`,\`message_id\`) WHERE client_id IS NOT NULL;
CREATE TABLE \`system_state\` (
	\`key\` text PRIMARY KEY NOT NULL,
	\`value\` text NOT NULL,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP,
	\`updated_at\` text DEFAULT CURRENT_TIMESTAMP
);
`;


export interface TestDb {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}





export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(BASELINE_SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}


export function asDrizzle(testDb: TestDb): DrizzleDB {
  return testDb.db as unknown as DrizzleDB;
}












export function seedClient(
  testDb: TestDb,
  overrides: Partial<typeof schema.clients.$inferInsert> = {}
): typeof schema.clients.$inferSelect {
  const base: typeof schema.clients.$inferInsert = {
    userId: 7,
    token: 'seed-token-' + Math.random().toString(36).slice(2),
    name: 'Old Device',
    platform: 'huawei',
    deviceUid: 'device-abc',
    deviceToken: 'old-push-token-' + Math.random().toString(36).slice(2),
    tokenUpdatedAt: null,
    tokenStatus: 'active',
    appVersion: null,
    deviceModel: null,
    ...overrides
  };
  const [row] = testDb.db.insert(schema.clients).values(base).returning().all();
  return row;
}
