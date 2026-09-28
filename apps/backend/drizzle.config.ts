import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://waypoint:waypoint@localhost:5432/waypoint',
  },
  strict: true,
  verbose: true,
});
