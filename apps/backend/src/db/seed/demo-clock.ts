import { addDays, businessDateOf } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { clockModeSchema } from '../../core/settings/settings.registry';
import { settings } from '../schema';
import type { DbLike } from './db-like';

/**
 * D−1, D and D+1 for the seed and `pnpm db:reset-demo`, the same days POST /demo/reset uses: D is
 * the day after the demo clock's business date. Outside demo mode the clock is the wall clock.
 * DEMO_DAY=YYYY-MM-DD pins D for a one-off run.
 */
export async function demoDays(db: DbLike): Promise<string[]> {
  const pinned = process.env.DEMO_DAY;
  if (pinned) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pinned))
      throw new Error(`DEMO_DAY "${pinned}" is not YYYY-MM-DD`);
    return [addDays(pinned, -1), pinned, addDays(pinned, 1)];
  }
  const today = businessDateOf(await clockNow(db));
  return [today, addDays(today, 1), addDays(today, 2)];
}

async function clockNow(db: DbLike): Promise<Date> {
  if (process.env.DEMO_MODE !== 'true') return new Date();
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'demo.clock'), eq(settings.scope, 'global')));
  const mode = clockModeSchema.safeParse(row?.value);
  if (mode.success) {
    if (mode.data.mode === 'frozen' || mode.data.mode === 'simulated')
      return new Date(mode.data.at);
    if (mode.data.mode === 'offset')
      return new Date(Date.now() + mode.data.offsetMs);
    return new Date();
  }
  return process.env.DEMO_CLOCK ? new Date(process.env.DEMO_CLOCK) : new Date();
}
