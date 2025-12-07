import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { applications } from './application';

export const messages = sqliteTable('messages', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userid: integer('userid', { mode: 'number' }).notNull(),
  appid: integer('appid', { mode: 'number' }).notNull().references(() => applications.id),
  message: text('message').notNull(),
  title: text('title'),
  priority: integer('priority', { mode: 'number' }).default(0),
  extras: text('extras'),
  date: text('date').default(sql`CURRENT_TIMESTAMP`),
  expires: text('expires')
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;