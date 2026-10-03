import { eq } from 'drizzle-orm';
import { vehicles } from '../schema';
import type { DbLike } from './db-like';
import { historySourceDays, type HistoryRow } from './history';
import {
  insertSeedOrders,
  outletsById,
  saveSnapshot,
  tempFor,
  type SeedOrder,
} from './seed-orders';

export const KANDY = 'KDY';

export interface KandyDay {
  sourceDay: string;
  orders: number;
  created: number;
  volumeM3: number;
}

/**
 * Kandy's demo day. S1 is a Peliyagoda scenario, so Kandy's D is an ordinary day: the orders
 * Kandy's outlets placed for the last dispatch day in deliveries_train.csv, CONFIRMED on D with
 * the whole Kandy fleet in service. That day is never part of the history (history.ts), so the
 * refs don't collide. Its snapshot goes in `demo.s1` like Peliyagoda's, so the same reset
 * rebuilds it. Safe on every seed: an order already loaded is left as it is.
 */
export async function importKandyDay(
  db: DbLike,
  rows: readonly HistoryRow[],
  demoDay: string,
  depotId = KANDY,
): Promise<KandyDay | null> {
  const { last } = historySourceDays(rows);
  if (!last) return null;
  const sameDay = rows.filter((r) => r.orderDate === last);
  const outletOf = await outletsById(
    db,
    sameDay.map((r) => r.outletId),
  );
  const batch: SeedOrder[] = [];
  for (const row of sameDay) {
    const outlet = outletOf.get(row.outletId);
    if (outlet?.depotId !== depotId) continue;
    batch.push({
      ref: row.ref,
      outlet,
      tempClass: tempFor(outlet.brand, row.tempClass),
      units: row.units,
      weightKg: row.weightKg,
      volumeM3: row.volumeM3,
    });
  }
  if (batch.length === 0) return null;

  const created = await insertSeedOrders(db, batch, () => ({
    requestedDate: demoDay,
    deliveryDate: demoDay,
    status: 'CONFIRMED',
  }));
  const fleet = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.depotId, depotId));
  await saveSnapshot(db, depotId, {
    v: 2,
    orders: batch.map((o) => o.ref),
    deferredYesterday: [],
    workshop: [],
    available: fleet.map((v) => v.id).sort(),
    draftOutletId: null,
  });
  return {
    sourceDay: last,
    orders: batch.length,
    created: created.size,
    volumeM3: batch.reduce((n, o) => n + o.volumeM3, 0),
  };
}
