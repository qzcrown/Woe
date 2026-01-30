import { integer, text, real, blob, sqliteTable, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const pluginConfigs = sqliteTable('plugin_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  token: text('token').notNull(),
  modulePath: text('module_path').notNull(),
  icon: text('icon'),
  configYaml: text('config_yaml'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});