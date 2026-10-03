/**
 * Rebuilds the demo day (D−1 to D+1) from the S1 snapshot the seed stored, in one transaction:
 * the same rebuild POST /demo/reset runs. Local databases only.
 *   pnpm db:reset-demo
 * The API's reset also writes an audit row; this script does not, because it runs outside the API
 * where the audit chain is kept.
 */
import { createDatabase, createPool } from './client';
import { demoDays } from './seed/demo-clock';
import { rebuildDemoDay } from './seed/rebuild';
import { loadEnv, ownerUrl } from './env';

async function main() {
  loadEnv();
  const pool = createPool(ownerUrl());
  try {
    const db = createDatabase(pool);
    const days = await demoDays(db);
    const result = await db.transaction((tx) => rebuildDemoDay(tx, days));
    console.log(
      `[reset-demo] demo day ${days[1]} (${days[0]} to ${days[2]}): ${result.deleted} rows cleared, ${result.created} rebuilt`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[reset-demo] failed:', err);
  process.exit(1);
});
