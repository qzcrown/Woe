import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  pass: text('pass').notNull(),
  admin: integer('admin', { mode: 'boolean' }).notNull().default(false),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  // User profile fields
  nickname: text('nickname').notNull(),
  email: text('email').notNull(),
  avatar: text('avatar'),
  description: text('description'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;