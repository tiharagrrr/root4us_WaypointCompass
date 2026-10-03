import {
  addDays,
  cutoffFor,
  instantAt,
  previousOperatingDay,
  type OperatingLookup,
  type TempClass,
} from '@waypoint/shared';
import { and, between, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  calendarDays,
  deferrals,
  orders,
  plans,
  serviceAllowances,
  stops,
  trips,
  vehicles,
} from '../schema';
import { amount, field, isoDate, toMinutes, type Row } from './csv';
import type { DbLike } from './db-like';
import {
  insertSeedOrders,
  outletsById,
  tempFor,
  type SeedOrder,
} from './seed-orders';

export const HISTORY_FILE = 'deliveries_train.csv';

/** Operating days of history before the demo window (specs/data/datasets.md). */
export const HISTORY_DAYS = 14;

type DispatchStatus = 'attempted' | 'deferred' | 'not_run';

/** One deliveries_train.csv row, mapped by header name. */
export interface HistoryRow {
  ref: string;
  outletId: string;
  orderDate: string;
  /** Blank when the order never ran. */
  dispatchDate: string | null;
  status: DispatchStatus;
  tempClass: TempClass;
  units: number;
  weightKg: number;
  volumeM3: number;
  routeId: string | null;
  seq: number | null;
  vehicleId: string | null;
  plannedArrivalMin: number | null;
  windowOpenMin: number | null;
  windowCloseMin: number | null;
}

const optional = (row: Row, name: string) => row[name] || null;

export function parseHistory(rows: readonly Row[]): HistoryRow[] {
  return rows.map((row) => {
    const where = `history ${row.delivery_id ?? '?'}`;
    const status = field(row, 'dispatch_status', where).toLowerCase();
    if (status !== 'attempted' && status !== 'deferred' && status !== 'not_run')
      throw new Error(
        `[seed] ${where}: dispatch_status "${status}" is not attempted, deferred or not_run`,
      );
    const temp = field(row, 'temp_requirement', where).toLowerCase();
    if (temp !== 'chilled' && temp !== 'ambient')
      throw new Error(
        `[seed] ${where}: temp_requirement "${temp}" is not chilled or ambient`,
      );
    const time = (name: string) => {
      const v = optional(row, name);
      return v ? toMinutes(v) : null;
    };
    const seq = optional(row, 'seq_in_route');
    return {
      ref: field(row, 'delivery_id', where),
      outletId: field(row, 'outlet_id', where),
      orderDate: isoDate(row, 'order_date', where),
      dispatchDate: row.dispatch_date
        ? isoDate(row, 'dispatch_date', where)
        : null,
      status,
      tempClass: temp === 'chilled' ? 'CHILLED' : 'AMBIENT',
      units: Math.round(amount(row, 'order_units', where)),
      weightKg: amount(row, 'order_weight_kg', where),
      volumeM3: amount(row, 'order_volume_m3', where),
      routeId: optional(row, 'route_id'),
      seq: seq === null ? null : Number(seq),
      vehicleId: optional(row, 'vehicle_id'),
      plannedArrivalMin: time('planned_arrival_time'),
      windowOpenMin: time('window_open_time'),
      windowCloseMin: time('window_close_time'),
    };
  });
}

/** Rows that ran (on their day, or later after a deferral). */
const ran = (r: HistoryRow): r is HistoryRow & { dispatchDate: string } =>
  r.status !== 'not_run' && r.dispatchDate !== null;

/** Every dispatch date in the file, oldest first. */
export function dispatchDays(rows: readonly HistoryRow[]): string[] {
  return [...new Set(rows.filter(ran).map((r) => r.dispatchDate))].sort();
}

/**
 * The file's last dispatch day becomes Kandy's demo day (kandy-day.ts); the `count` before it are
 * history. Source days are the file's own, so each lines up with an operating day.
 */
export function historySourceDays(
  rows: readonly HistoryRow[],
  count = HISTORY_DAYS,
): { history: string[]; last: string | null } {
  const days = dispatchDays(rows);
  return { history: days.slice(-count - 1, -1), last: days.at(-1) ?? null };
}

/** The `count` operating days before D−1, oldest first; D−1 to D+1 belong to the demo reset. */
export function historyTargetDays(
  demoDay: string,
  count: number,
  known?: OperatingLookup,
): string[] {
  const days: string[] = [];
  let day = addDays(demoDay, -1);
  for (let i = 0; i < count; i += 1) {
    day = previousOperatingDay(day, known);
    days.unshift(day);
  }
  return days;
}

/** `is_operating` from the seeded calendar, or the Monday-to-Saturday default where it has no row. */
export async function operatingLookup(
  db: DbLike,
  from: string,
  to: string,
): Promise<OperatingLookup> {
  const rows = await db
    .select({ date: calendarDays.date, isOperating: calendarDays.isOperating })
    .from(calendarDays)
    .where(between(calendarDays.date, from, to));
  const known = new Map(rows.map((r) => [r.date, r.isOperating]));
  return (date) => known.get(date);
}

export interface HistoryResult {
  days: string[];
  plans: number;
  orders: number;
  trips: number;
  deferrals: number;
  skipped: number;
}

type Shifted = SeedOrder & {
  row: HistoryRow & { dispatchDate: string };
  requestedDate: string;
  deliveryDate: string;
};

const DELIVERED_NOTE =
  'Every suitable vehicle was full on this run. Your order goes first on the next one.';

/**
 * Loads the `HISTORY_DAYS` operating days before the demo window from deliveries_train.csv, with
 * dates shifted so the last source day lands on the operating day before D−1 (specs/data/
 * datasets.md, History). Each source day is one CLOSED plan per depot; each route a COMPLETED
 * trip; each order that ran a DELIVERED order with its stop; each `deferred` row a CONFIRMED
 * deferral on its order day's plan, acknowledged by the store. This is what the engine's fairness
 * history reads: an outlet's last delivered order gives `daysSinceLastServed`.
 *
 * Not loaded: `not_run` rows (an open question), actual times (route_legs_train.csv), drivers and
 * receipts. Loads once: if any history order or a plan in the window already exists, it does
 * nothing, so a re-seed changes nothing; `pnpm db:reset` loads it fresh.
 */
export async function importHistory(
  db: DbLike,
  rows: readonly HistoryRow[],
  demoDay: string,
): Promise<HistoryResult | null> {
  const { history } = historySourceDays(rows);
  if (history.length === 0) return null;
  const known = await operatingLookup(
    db,
    addDays(demoDay, -3 * history.length - 30),
    demoDay,
  );
  const target = historyTargetDays(demoDay, history.length, known);
  const shift = new Map(history.map((d, i) => [d, target[i]]));
  const result: HistoryResult = {
    days: target,
    plans: 0,
    orders: 0,
    trips: 0,
    deferrals: 0,
    skipped: 0,
  };

  const inWindow = rows.filter(ran).filter((r) => shift.has(r.dispatchDate));
  const outletOf = await outletsById(
    db,
    inWindow.map((r) => r.outletId),
  );
  const fileDepots = [...new Set([...outletOf.values()].map((o) => o.depotId))];
  if (fileDepots.length === 0) return null;
  const existingPlans = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        inArray(plans.depotId, fileDepots),
        between(plans.date, target[0], target.at(-1)!),
      ),
    );
  const existingOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      inArray(
        orders.externalRef,
        inWindow.slice(0, 500).map((r) => r.ref),
      ),
    );
  if (existingPlans.length || existingOrders.length) {
    console.log(
      `[seed] history ${target[0]} to ${target.at(-1)} already has plans or orders; left as it is`,
    );
    return null;
  }

  // Vehicles and allowances, to check each route and give each stop its planned service time.
  const vehicleDepot = new Map(
    (
      await db
        .select({ id: vehicles.id, depotId: vehicles.depotId })
        .from(vehicles)
    ).map((v) => [v.id, v.depotId]),
  );
  const allowance = new Map(
    (await db.select().from(serviceAllowances)).map((a) => [
      `${a.brand}:${a.dockType}`,
      a.minutes,
    ]),
  );

  // Group into routes; drop what cannot be stored, and say how much.
  const routes = new Map<string, Shifted[]>();
  for (const row of inWindow) {
    const outlet = outletOf.get(row.outletId);
    if (!outlet || !row.routeId || !row.vehicleId) {
      result.skipped += 1;
      continue;
    }
    const deliveryDate = shift.get(row.dispatchDate)!;
    const requestedDate =
      shift.get(row.orderDate) ??
      addDays(
        deliveryDate,
        -Math.round(
          (Date.parse(row.dispatchDate) - Date.parse(row.orderDate)) /
            86_400_000,
        ),
      );
    const key = `${row.dispatchDate}|${row.routeId}`;
    const list = routes.get(key) ?? [];
    list.push({
      ref: row.ref,
      outlet,
      tempClass: tempFor(outlet.brand, row.tempClass),
      units: row.units,
      weightKg: row.weightKg,
      volumeM3: row.volumeM3,
      row,
      requestedDate,
      deliveryDate,
    });
    routes.set(key, list);
  }

  // One brand, district and depot per route, on a vehicle from that depot; at most two a day.
  const kept: { route: Shifted[]; tripNo: number }[] = [];
  const slots = new Map<string, number>();
  const firstArrival = (route: Shifted[]) =>
    Math.min(...route.map((o) => o.row.plannedArrivalMin ?? 1440));
  for (const route of [...routes.values()].sort(
    (a, b) =>
      a[0].deliveryDate.localeCompare(b[0].deliveryDate) ||
      firstArrival(a) - firstArrival(b),
  )) {
    const head = route[0];
    const vehicleId = head.row.vehicleId!;
    const consistent = route.every(
      (o) =>
        o.outlet.depotId === head.outlet.depotId &&
        o.outlet.brand === head.outlet.brand &&
        o.outlet.districtId === head.outlet.districtId &&
        o.row.vehicleId === vehicleId,
    );
    const slot = `${head.deliveryDate}|${vehicleId}`;
    const tripNo = (slots.get(slot) ?? 0) + 1;
    if (
      !consistent ||
      vehicleDepot.get(vehicleId) !== head.outlet.depotId ||
      tripNo > 2
    ) {
      result.skipped += route.length;
      continue;
    }
    slots.set(slot, tripNo);
    kept.push({ route, tripNo });
  }
  const loaded = kept.flatMap((k) => k.route);

  // Plans: one CLOSED plan per depot and day, so every deferral has its order day's plan.
  const depots = [...new Set(loaded.map((o) => o.outlet.depotId))].sort();
  const planOf = new Map<string, string>();
  const planRows = depots.flatMap((depotId) =>
    target.map((date) => {
      const id = uuidv7();
      planOf.set(`${depotId}|${date}`, id);
      return {
        id,
        depotId,
        date,
        status: 'CLOSED' as const,
        revision: 1,
        cutoffClosedAt: cutoffFor(date, 960, known),
        publishedAt: instantAt(previousOperatingDay(date, known), 990),
        closedAt: instantAt(date, 1200),
      };
    }),
  );
  if (planRows.length) await db.insert(plans).values(planRows);
  result.plans = planRows.length;

  // Orders, with catalog lines that add up to each one.
  const orderIds = await insertSeedOrders(db, loaded, (o) => {
    const deferred = o.row.status === 'deferred';
    const asked = previousOperatingDay(o.requestedDate, known);
    return {
      requestedDate: o.requestedDate,
      deliveryDate: o.deliveryDate,
      status: 'DELIVERED',
      submittedAt: instantAt(asked, 600),
      confirmedAt: cutoffFor(o.requestedDate, 960, known),
      deferredCount: deferred ? 1 : 0,
      lastDeferredAt: deferred ? instantAt(o.requestedDate, 1200) : null,
    };
  });
  result.orders = orderIds.size;

  // Trips and stops: COMPLETED and DELIVERED as planned; actual times are not loaded.
  const tripRows: (typeof trips.$inferInsert)[] = [];
  const stopRows: (typeof stops.$inferInsert)[] = [];
  for (const { route, tripNo } of kept) {
    const head = route[0];
    const tripId = uuidv7();
    const sorted = [...route].sort(
      (a, b) =>
        (a.row.seq ?? 0) - (b.row.seq ?? 0) ||
        (a.row.plannedArrivalMin ?? 0) - (b.row.plannedArrivalMin ?? 0),
    );
    const at = (o: Shifted) =>
      o.row.plannedArrivalMin === null
        ? null
        : instantAt(o.deliveryDate, o.row.plannedArrivalMin);
    tripRows.push({
      id: tripId,
      planId: planOf.get(`${head.outlet.depotId}|${head.deliveryDate}`)!,
      depotId: head.outlet.depotId,
      vehicleId: head.row.vehicleId!,
      tripNo,
      brand: head.outlet.brand,
      districtId: head.outlet.districtId,
      tempClass: route.some((o) => o.tempClass === 'CHILLED')
        ? 'CHILLED'
        : 'AMBIENT',
      status: 'COMPLETED',
      locked: true,
      loadWeightKg: route.reduce((n, o) => n + o.weightKg, 0),
      loadVolumeM3: route.reduce((n, o) => n + o.volumeM3, 0),
    });
    sorted.forEach((o, seq) => {
      const open = o.row.windowOpenMin ?? o.outlet.windowOpenMin;
      const close = o.row.windowCloseMin ?? o.outlet.windowCloseMin;
      const valid = close > open;
      stopRows.push({
        id: uuidv7(),
        tripId,
        orderId: orderIds.get(o.ref)!,
        outletId: o.outlet.id,
        depotId: o.outlet.depotId,
        brand: o.outlet.brand,
        districtId: o.outlet.districtId,
        seq,
        status: 'DELIVERED',
        plannedArrivalAt: at(o),
        plannedServiceMin:
          allowance.get(`${o.outlet.brand}:${o.outlet.dockType}`) ?? 15,
        windowOpenMin: valid ? open : o.outlet.windowOpenMin,
        windowCloseMin: valid ? close : o.outlet.windowCloseMin,
        outcome: 'DELIVERED',
        unitsDelivered: o.units,
      });
    });
  }
  for (let i = 0; i < tripRows.length; i += 500)
    await db.insert(trips).values(tripRows.slice(i, i + 500));
  for (let i = 0; i < stopRows.length; i += 500)
    await db.insert(stops).values(stopRows.slice(i, i + 500));
  // The stop that served each order, as planning's PLAN transition records it.
  for (let i = 0; i < tripRows.length; i += 500) {
    const ids = tripRows.slice(i, i + 500).map((t) => sql`${t.id}`);
    await db.execute(
      sql`UPDATE orders o SET "activeStopId" = s.id FROM stops s
          WHERE s."orderId" = o.id AND s."tripId" IN (${sql.join(ids, sql`, `)})`,
    );
  }
  result.trips = tripRows.length;

  // A deferred row waited from its order day's run to the one that took it.
  const deferralRows = loaded
    .filter(
      (o) =>
        o.row.status === 'deferred' &&
        o.requestedDate < o.deliveryDate &&
        planOf.has(`${o.outlet.depotId}|${o.requestedDate}`),
    )
    .map((o) => ({
      orderId: orderIds.get(o.ref)!,
      planId: planOf.get(`${o.outlet.depotId}|${o.requestedDate}`)!,
      status: 'CONFIRMED' as const,
      source: 'PLANNING' as const,
      reasonCode: 'OVER_CAPACITY',
      note: DELIVERED_NOTE,
      fromDate: o.requestedDate,
      toDate: o.deliveryDate,
      decidedAt: instantAt(previousOperatingDay(o.requestedDate, known), 980),
      storeResponse: 'ACKNOWLEDGED' as const,
      storeRespondedAt: instantAt(o.requestedDate, 420),
    }));
  for (let i = 0; i < deferralRows.length; i += 500)
    await db.insert(deferrals).values(deferralRows.slice(i, i + 500));
  result.deferrals = deferralRows.length;
  return result;
}
