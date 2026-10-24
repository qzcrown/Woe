






import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';


export const pluginJobs = sqliteTable('plugin_jobs', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull(),
  pluginId: integer('plugin_id', { mode: 'number' }).notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: integer('subject_id', { mode: 'number' }).notNull(),
  payload: text('payload'),
  status: text('status').notNull().default('pending'),
  result: text('result'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at')
}, (t) => [

  uniqueIndex('plugin_jobs_active_subject_unique')
    .on(t.pluginId, t.subjectType, t.subjectId)
    .where(sql`status = 'pending'`),
  index('plugin_jobs_status_created_idx').on(t.status, t.createdAt),
  index('plugin_jobs_user_subject_idx').on(t.userId, t.subjectType, t.subjectId)
]);

export type PluginJob = typeof pluginJobs.$inferSelect;
export type InsertPluginJob = typeof pluginJobs.$inferInsert;
