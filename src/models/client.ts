import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './user';

export const clients = sqliteTable('clients', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  name: text('name').notNull(),
  lastUsed: text('last_used'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;