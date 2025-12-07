import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const pluginLogs = sqliteTable('plugin_logs', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  pluginId: integer('plugin_id', { mode: 'number' }).notNull(),
  userId: integer('user_id', { mode: 'number' }).notNull(),
  event: text('event').notNull(),
  status: integer('status', { mode: 'number' }).notNull(),
  durationMs: integer('duration_ms', { mode: 'number' }),
  error: text('error'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export type PluginLog = typeof pluginLogs.$inferSelect;
export type InsertPluginLog = typeof pluginLogs.$inferInsert;