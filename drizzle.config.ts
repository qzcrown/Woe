import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/models/index.ts',
  out: './src/migrations/sql',
  dialect: 'sqlite',
  driver: 'd1-http',
});
