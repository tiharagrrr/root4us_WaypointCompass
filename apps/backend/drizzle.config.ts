import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * Migrations connect as compass_owner (DIRECT_URL): the only role that changes
 * the schema. Generate through `pnpm db:generate --name=<module>_<change>`, which
 * wraps drizzle-kit and names files YYYYMMDDHHMM_<module>_<change>.sql.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts', // barrel: every table, enum, sequence and relation
  out: './drizzle', // SQL migrations and meta snapshots, committed
  dbCredentials: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgres://compass_owner:compass_owner@localhost:5432/waypoint',
  },
  migrations: { prefix: 'timestamp' },
  strict: true,
  verbose: true,
});
