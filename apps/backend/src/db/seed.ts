/**
 * Seeds the database from the challenge datasets in SEED_DATA_DIR: reference data, persona users,
 * then the catalog, history and demo day (src/db/seed/). Idempotent, so it runs on each
 * `docker compose up`. Connects as compass_owner (DIRECT_URL), which bypasses row-level security.
 *   dev:    pnpm db:seed
 *   docker: node dist/db/seed.js (run by the `seed` service)
 */
import { resolve } from 'node:path';
import { createDatabase, createPool } from './client';
import { loadEnv, ownerUrl, REPO_ROOT } from './env';
import { seedDemoDay } from './seed/demo-day';
import { seedReferenceData } from './seed/reference-data';
import { seedUsers } from './seed-users';

async function main() {
  loadEnv();
  const dir = process.env.SEED_DATA_DIR
    ? resolve(process.env.SEED_DATA_DIR)
    : resolve(REPO_ROOT, 'data/seed');
  const pool = createPool(ownerUrl());
  try {
    const db = createDatabase(pool);
    await seedReferenceData(db, dir);
    const password = process.env.SEED_PASSWORD ?? '';
    if (password.length >= 10) await seedUsers(db, password);
    else
      console.warn(
        '[seed] SEED_PASSWORD needs 10+ characters; skipping persona accounts',
      );
    await seedDemoDay(db, dir);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
