import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const migrations = sqliteTable('_migrations', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  appliedAt: text('applied_at').default(sql`CURRENT_TIMESTAMP`)
});

export type Migration = typeof migrations.$inferSelect;
export type InsertMigration = typeof migrations.$inferInsert;