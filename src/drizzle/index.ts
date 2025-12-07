import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

// Import all tables
import * as schema from '../models';

export function createDrizzle(db: D1Database) {
  return drizzle(db, {
    schema,
    logger: true
  });
}

export type DrizzleDB = ReturnType<typeof createDrizzle>;