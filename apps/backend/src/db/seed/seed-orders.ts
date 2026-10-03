import type { Brand, TempClass } from '@waypoint/shared';
import { inArray, sql } from 'drizzle-orm';
import {
  orderNoFor,
  ORDER_NO_SEQUENCE,
} from '../../modules/ordering/domain/order-number';
import { items, orderLines, orders, outlets, settings } from '../schema';
import { adjustmentFor, catalogFor } from './catalog';
import type { DbLike } from './db-like';
import { linesFor, type LineSpec } from './order-lines';
import { S1_SETTING, type S1Snapshot } from './s1';

/** The outlet columns a seeded order copies; the outlets row is the source, never the CSV. */
export interface SeedOutlet {
  id: string;
  brand: Brand;
  depotId: string;
  districtId: string;
  dockType: (typeof outlets.$inferSelect)['dockType'];
  windowOpenMin: number;
  windowCloseMin: number;
}

/** One dataset order with its sizes, before it has an id. */
export interface SeedOrder {
  ref: string;
  outlet: SeedOutlet;
  tempClass: TempClass;
  units: number;
  weightKg: number;
  volumeM3: number;
}

export type OrderValues = Omit<
  typeof orders.$inferInsert,
  | 'orderNo'
  | 'outletId'
  | 'depotId'
  | 'brand'
  | 'districtId'
  | 'tempClass'
  | 'units'
  | 'weightKg'
  | 'volumeM3'
  | 'source'
  | 'externalRef'
>;

/** Rows per insert, well under Postgres' bind-parameter limit. */
const CHUNK = 500;

function* chunks<T>(rows: readonly T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += CHUNK) yield rows.slice(i, i + CHUNK);
}

/** The seeded outlets for these ids, by id. */
export async function outletsById(
  db: DbLike,
  ids: readonly string[],
): Promise<Map<string, SeedOutlet>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: outlets.id,
      brand: outlets.brand,
      depotId: outlets.depotId,
      districtId: outlets.districtId,
      dockType: outlets.dockType,
      windowOpenMin: outlets.windowOpenMin,
      windowCloseMin: outlets.windowCloseMin,
    })
    .from(outlets)
    .where(inArray(outlets.id, unique));
  return new Map(rows.map((o) => [o.id, o]));
}

/** Only Fresh has chilled goods (specs/data/datasets.md, Known quirks). */
export const tempFor = (brand: Brand, temp: TempClass): TempClass =>
  brand === 'FRESH' ? temp : 'AMBIENT';

/** The next `n` order numbers for a brand, from the same sequence M1 uses. */
export async function nextOrderNos(
  db: DbLike,
  brand: Brand,
  n: number,
): Promise<string[]> {
  if (n === 0) return [];
  const result = await db.execute<{ nextval: string }>(
    sql`SELECT nextval(${ORDER_NO_SEQUENCE[brand]}) AS nextval FROM generate_series(1, ${n})`,
  );
  return result.rows.map((r) => orderNoFor(brand, Number(r.nextval)));
}

export async function nextOrderNo(db: DbLike, brand: Brand): Promise<string> {
  const [no] = await nextOrderNos(db, brand, 1);
  return no;
}

/** Writes orders' lines, resolving each SKU to its catalog item. */
export async function insertLines(
  db: DbLike,
  byOrder: readonly { orderId: string; lines: readonly LineSpec[] }[],
): Promise<void> {
  const skus = [...new Set(byOrder.flatMap((o) => o.lines.map((l) => l.sku)))];
  if (skus.length === 0) return;
  const rows = await db
    .select({ id: items.id, sku: items.sku })
    .from(items)
    .where(inArray(items.sku, skus));
  const idOf = new Map(rows.map((r) => [r.sku, r.id]));
  const values = byOrder.flatMap(({ orderId, lines }) =>
    lines.map((l) => {
      const itemId = idOf.get(l.sku);
      if (!itemId)
        throw new Error(
          `[seed] item ${l.sku} is not in the catalog; seed the catalog first`,
        );
      return {
        orderId,
        itemId,
        qty: l.qty,
        unitWeightKg: l.unitWeightKg,
        unitVolumeM3: l.unitVolumeM3,
        unitValueLkr: l.unitValueLkr,
      };
    }),
  );
  for (const chunk of chunks(values)) await db.insert(orderLines).values(chunk);
}

/** Catalog lines that add up exactly to the order (specs/data/datasets.md). */
export const seedLines = (order: SeedOrder): LineSpec[] =>
  linesFor(
    order.ref,
    order,
    catalogFor(order.outlet.brand, order.tempClass),
    adjustmentFor(order.outlet.brand, order.tempClass),
  );

/**
 * Inserts dataset orders keyed on `externalRef`, each with catalog lines that sum to its totals.
 * `values` gives each order's dates and status. Refs already in the database are left alone, so
 * this is safe on every seed. Returns the new orders' ids by ref.
 */
export async function insertSeedOrders<T extends SeedOrder>(
  db: DbLike,
  batch: readonly T[],
  values: (order: T) => OrderValues,
): Promise<Map<string, string>> {
  const loaded = new Set<string>();
  for (const chunk of chunks(batch.map((o) => o.ref))) {
    const rows = await db
      .select({ ref: orders.externalRef })
      .from(orders)
      .where(inArray(orders.externalRef, chunk));
    for (const r of rows) if (r.ref) loaded.add(r.ref);
  }
  const todo = batch.filter((o) => !loaded.has(o.ref));

  const numbers = new Map<Brand, string[]>();
  for (const brand of ['FRESH', 'STYLE', 'TECH'] as const)
    numbers.set(
      brand,
      await nextOrderNos(
        db,
        brand,
        todo.filter((o) => o.outlet.brand === brand).length,
      ),
    );

  const idOf = new Map<string, string>();
  for (const chunk of chunks(todo)) {
    const rows = await db
      .insert(orders)
      .values(
        chunk.map((o) => ({
          ...values(o),
          orderNo: numbers.get(o.outlet.brand)!.shift()!,
          outletId: o.outlet.id,
          depotId: o.outlet.depotId,
          brand: o.outlet.brand,
          districtId: o.outlet.districtId,
          tempClass: o.tempClass,
          units: o.units,
          weightKg: o.weightKg,
          volumeM3: o.volumeM3,
          source: 'seed',
          externalRef: o.ref,
        })),
      )
      .returning({ id: orders.id, ref: orders.externalRef });
    for (const r of rows) if (r.ref) idOf.set(r.ref, r.id);
  }
  await insertLines(
    db,
    todo.map((o) => ({ orderId: idOf.get(o.ref)!, lines: seedLines(o) })),
  );
  return idOf;
}

/** Saves the snapshot a reset rebuilds this depot's demo day from. */
export async function saveSnapshot(
  db: DbLike,
  depotId: string,
  snapshot: S1Snapshot,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key: S1_SETTING, scope: depotId, value: snapshot })
    .onConflictDoUpdate({
      target: [settings.key, settings.scope],
      set: { value: snapshot },
    });
}
