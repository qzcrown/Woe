import { integer, text, sqliteTable, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const userPluginPermissions = sqliteTable('user_plugin_permissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  modulePath: text('module_path').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  // Ensure each user can only have one permission record per plugin
  uniqueUserPlugin: unique().on(table.userId, table.modulePath)
}));
