import { inArray } from 'drizzle-orm';
import { vehicles } from '../schema';
import { readSeedCsv } from './csv';
import type { DbLike } from './db-like';
import { PERSONA_OUTLET } from './outlet-names';
import { parseS1Fleet, parseS1Orders, S1_FILES } from './s1';
import {
  insertSeedOrders,
  outletsById,
  saveSnapshot,
  tempFor,
  type SeedOrder,
} from './seed-orders';

export interface S1Import {
  orders: number;
  created: number;
  depots: string[];
  /** S1 demand, for the seed's check against the available fleet. */
  demand: { volumeM3: number; chilledM3: number };
}

/**
 * Loads scenario S1 (specs/data/datasets.md): every order once, keyed on its `order_ref`, with
 * catalog lines that add up to its totals, and the depot's snapshot that a reset rebuilds the demo
 * day from. An order already loaded is left as it is, so this is safe to run on every seed;
 * `rebuildDemoDay` then puts each order on the demo day in its seeded state.
 */
export async function importS1(
  db: DbLike,
  dir: string,
  demoDay: string,
  opts: { draftOutletId?: string } = {},
): Promise<S1Import | null> {
  const orderRows = readSeedCsv(dir, S1_FILES.orders);
  if (!orderRows) {
    console.warn(`[seed] ${S1_FILES.orders} not found in ${dir}; no demo day`);
    return null;
  }
  const s1 = parseS1Orders(orderRows);
  const fleet = parseS1Fleet(readSeedCsv(dir, S1_FILES.fleet) ?? []);

  const draftId = opts.draftOutletId ?? PERSONA_OUTLET.id;
  const outletOf = await outletsById(db, [
    ...s1.map((o) => o.outletId),
    draftId,
  ]);
  const known: (SeedOrder & { deferredYesterday: boolean })[] = [];
  for (const o of s1) {
    const outlet = outletOf.get(o.outletId);
    if (!outlet) {
      console.warn(
        `[seed] S1 ${o.ref}: outlet ${o.outletId} is not seeded; skipped`,
      );
      continue;
    }
    known.push({ ...o, outlet, tempClass: tempFor(outlet.brand, o.tempClass) });
  }

  const created = await insertSeedOrders(db, known, () => ({
    requestedDate: demoDay,
    deliveryDate: demoDay,
    status: 'CONFIRMED',
  }));

  // One snapshot per depot the scenario touches.
  const vehicleRows = await db
    .select({ id: vehicles.id, depotId: vehicles.depotId })
    .from(vehicles)
    .where(inArray(vehicles.id, [...fleet.workshop, ...fleet.available, '']));
  const depotOfVehicle = new Map(vehicleRows.map((v) => [v.id, v.depotId]));
  const draftOutlet = outletOf.get(draftId);
  const depots = [...new Set(known.map((o) => o.outlet.depotId))].sort();
  for (const depotId of depots) {
    const here = known.filter((o) => o.outlet.depotId === depotId);
    await saveSnapshot(db, depotId, {
      v: 2,
      orders: here.map((o) => o.ref),
      deferredYesterday: here
        .filter((o) => o.deferredYesterday)
        .map((o) => o.ref),
      workshop: fleet.workshop.filter(
        (id) => depotOfVehicle.get(id) === depotId,
      ),
      available: fleet.available.filter(
        (id) => depotOfVehicle.get(id) === depotId,
      ),
      draftOutletId:
        draftOutlet?.depotId === depotId && draftOutlet.brand === 'FRESH'
          ? draftOutlet.id
          : null,
    });
  }

  return {
    orders: known.length,
    created: created.size,
    depots,
    demand: {
      volumeM3: known.reduce((n, o) => n + o.volumeM3, 0),
      chilledM3: known
        .filter((o) => o.tempClass === 'CHILLED')
        .reduce((n, o) => n + o.volumeM3, 0),
    },
  };
}
