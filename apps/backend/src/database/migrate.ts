/**
 * Applies Drizzle migrations from apps/backend/drizzle, then the hand-written SQL
 * in ./sql (triggers etc.). Safe to run on every start.
 *   dev:    pnpm db:migrate
 *   docker: node dist/database/migrate.js (run by the `seed` service)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './client';
import { loadEnv, requireEnv } from './env';

const MIGRATIONS_DIR = resolve(__dirname, '../../drizzle');
// .sql files are not compiled by tsc, so read them from src/ in both modes.
const SQL_DIR = resolve(__dirname, '../../src/database/sql');

async function main() {
  loadEnv();
  if (!existsSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'))) {
    throw new Error(
      `No migrations found in ${MIGRATIONS_DIR}. Run "pnpm db:generate" and commit the output.`,
    );
  }
  const pool = createPool(requireEnv('DATABASE_URL'));
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_DIR });
    for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      await pool.query(readFileSync(resolve(SQL_DIR, file), 'utf8'));
    }
    console.log('[migrate] database is up to date');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
