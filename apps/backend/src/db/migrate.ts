/**
 * Applies the committed SQL migrations in apps/backend/drizzle as compass_owner.
 * Triggers, grants and role bootstrap live in custom migrations there too, so this
 * is the only step. Safe to run on every start.
 *   dev:    pnpm db:migrate
 *   docker: node dist/db/migrate.js (run by the `seed` service)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './client';
import { loadEnv, ownerUrl } from './env';

const MIGRATIONS_DIR = resolve(__dirname, '../../drizzle');

async function main() {
  loadEnv();
  if (!existsSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'))) {
    throw new Error(
      `No migrations found in ${MIGRATIONS_DIR}. Run "pnpm db:generate" and commit the output.`,
    );
  }
  const pool = createPool(ownerUrl());
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_DIR });
    console.log('[migrate] database is up to date');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
