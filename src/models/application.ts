import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './user';

export const applications = sqliteTable('applications', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  defaultPriority: integer('default_priority', { mode: 'number' }).default(0),
  image: text('image'),
  internal: integer('internal', { mode: 'boolean' }).default(false),
  lastUsed: text('last_used'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export type Application = typeof applications.$inferSelect;
export type InsertApplication = typeof applications.$inferInsert;