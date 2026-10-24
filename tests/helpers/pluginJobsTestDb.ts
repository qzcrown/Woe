












import type { TestDb } from './testDb';
import { createMessageTestDb } from './messageTestDb';


const PLUGIN_JOBS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS \`user_plugin_permissions\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL,
	\`module_path\` text NOT NULL,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS \`user_plugin_permissions_user_id_module_path_unique\` ON \`user_plugin_permissions\` (\`user_id\`,\`module_path\`);
CREATE TABLE \`plugin_configs\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL,
	\`name\` text NOT NULL,
	\`token\` text NOT NULL,
	\`module_path\` text NOT NULL,
	\`icon\` text,
	\`config_yaml\` text,
	\`enabled\` integer DEFAULT 1 NOT NULL,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	\`updated_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	\`encrypted_secret\` text,
	\`usage_day\` text,
	\`usage_count\` integer DEFAULT 0 NOT NULL
);
CREATE TABLE \`plugin_logs\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`plugin_id\` integer NOT NULL,
	\`user_id\` integer NOT NULL,
	\`event\` text NOT NULL,
	\`status\` integer NOT NULL,
	\`duration_ms\` integer,
	\`error\` text,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE \`plugin_jobs\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL,
	\`plugin_id\` integer NOT NULL,
	\`subject_type\` text NOT NULL,
	\`subject_id\` integer NOT NULL,
	\`payload\` text,
	\`status\` text DEFAULT 'pending' NOT NULL,
	\`result\` text,
	\`last_error_code\` text,
	\`last_error_message\` text,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	\`updated_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	\`completed_at\` text
);
CREATE UNIQUE INDEX \`plugin_jobs_active_subject_unique\` ON \`plugin_jobs\` (\`plugin_id\`,\`subject_type\`,\`subject_id\`) WHERE status = 'pending';
CREATE INDEX \`plugin_jobs_status_created_idx\` ON \`plugin_jobs\` (\`status\`, \`created_at\`);
CREATE INDEX \`plugin_jobs_user_subject_idx\` ON \`plugin_jobs\` (\`user_id\`, \`subject_type\`, \`subject_id\`);
`;









export function createPluginJobsTestDb(): TestDb {
  const testDb = createMessageTestDb();
  testDb.sqlite.exec(PLUGIN_JOBS_SCHEMA_SQL);
  return testDb;
}
