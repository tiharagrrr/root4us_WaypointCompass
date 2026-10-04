import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../client';
import { orders, vehicles } from '../schema';
import { seedCatalog } from './catalog';
import { readSeedCsv } from './csv';
import { demoDays } from './demo-clock';
import { HISTORY_FILE, importHistory, parseHistory } from './history';
import { importS1 } from './import-s1';
import { importKandyDay } from './kandy-day';
import { placeOnMap } from './coordinates';
import { nameOutlets } from './outlet-names';
import { rebuildDemoDay } from './rebuild';

/**
 * Everything after the reference data (ROO-22): the item catalog, outlet names, 14 operating days
 * of history, and the demo day D at both depots (S1 at Peliyagoda, an ordinary day at Kandy),
 * rebuilt the way POST /demo/reset rebuilds it. Safe to run on every seed.
 */
export async function seedDemoDay(db: Database, dir: string): Promise<void> {
  const itemCount = await seedCatalog(db);
  const renamed = await nameOutlets(db);
  // After naming: an outlet goes on the map at the town it is named after.
  const placed = await placeOnMap(db);
  console.log(
    `[seed] catalog: ${itemCount} items; ${renamed} outlets named, ${placed.outlets} placed on the map`,
  );

  const days = await demoDays(db);
  const [, d] = days;
  const historyRows = readSeedCsv(dir, HISTORY_FILE);
  if (!historyRows)
    console.warn(
      `[seed] ${HISTORY_FILE} not found in ${dir}; no history or Kandy day`,
    );
  const history = parseHistory(historyRows ?? []);

  const result = await db.transaction(async (tx) => {
    const past = await importHistory(tx, history, d);
    const s1 = await importS1(tx, dir, d);
    const kandy = await importKandyDay(tx, history, d);
    if (s1 || kandy) await rebuildDemoDay(tx, days);
    return { past, s1, kandy };
  });

  const { past, s1, kandy } = result;
  if (past)
    console.log(
      `[seed] history ${past.days[0]} to ${past.days.at(-1)}: ${past.plans} closed plans, ` +
        `${past.trips} trips, ${past.orders} delivered orders, ${past.deferrals} deferrals` +
        (past.skipped
          ? `; ${past.skipped} rows skipped (unknown outlet or vehicle, or not one route per trip)`
          : ''),
    );
  if (kandy)
    console.log(
      `[seed] Kandy demo day ${d}: ${kandy.orders} orders (${kandy.created} new) from ${kandy.sourceDay}, ` +
        `${kandy.volumeM3.toFixed(1)} m³, the whole Kandy fleet in service`,
    );
  if (!s1) return;
  const onDay = await db.$count(
    orders,
    and(inArray(orders.depotId, s1.depots), eq(orders.deliveryDate, d)),
  );
  console.log(
    `[seed] demo day ${d}: ${s1.orders} S1 orders (${s1.created} new), ${onDay} orders on D at ${s1.depots.join(', ')}`,
  );

  // S1 is a day where demand exceeds the fleet (specs/data/datasets.md, Scenario S1).
  const fleet = await db
    .select()
    .from(vehicles)
    .where(
      and(inArray(vehicles.depotId, s1.depots), eq(vehicles.status, 'ACTIVE')),
    );
  const runs = 2;
  const capacity = fleet.reduce((n, v) => n + v.volumeCapM3 * runs, 0);
  const reefer = fleet
    .filter((v) => v.temp === 'REEFER')
    .reduce((n, v) => n + v.volumeCapM3 * runs, 0);
  const line = `S1 demand ${s1.demand.volumeM3.toFixed(1)} m³ (chilled ${s1.demand.chilledM3.toFixed(1)} m³) against ${fleet.length} available vehicles, ${capacity.toFixed(1)} m³ over two trips each (reefer ${reefer.toFixed(1)} m³)`;
  if (s1.demand.volumeM3 > capacity || s1.demand.chilledM3 > reefer)
    console.log(`[seed] ${line}: demand exceeds capacity`);
  else
    console.warn(
      `[seed] ${line}: capacity alone covers it; time budgets and windows decide what waits`,
    );
}
