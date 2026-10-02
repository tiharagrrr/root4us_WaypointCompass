import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import request, { type Response } from 'supertest';
import { browser, signedInAs } from '../../../../test/auth';
import { createTestApp, ownerDatabase } from '../../../../test/create-test-app';
import {
  calendarFixture,
  depotFixture,
  itemFixture,
  outletFixture,
  suffix,
} from '../../../../test/fixtures';
import { freezeClock } from '../../../../test/kernel';
import { ClockService } from '../../../core/clock/clock.service';
import type { Database } from '../../../db/client';
import {
  auditEvents,
  deliveryLines,
  outlets as outletsTable,
  orderLines,
  orders,
  outboxEvents,
  plans,
  stopEvents,
  stops,
  trips,
  vehicles,
} from '../../../db/schema';

/**
 * The world every execution suite runs in, built once per suite from
 * hand-made rows (the competition datasets stay out of tests, see
 * specs/data/datasets.md):
 *
 * - depot PLG with one district, and the demo calendar;
 * - six Fresh outlets on the Gampaha run, Kadawatha first, each with a
 *   delivery window, a dock type and an access note D9 shows;
 * - REF-07, a reefer, and DRY-31, an ambient truck, both at PLG;
 * - driver Aniqa, driver Dinushi, dispatcher Tihara, loader Harini, store
 *   manager Nimesha at Fresh Kadawatha, and an admin.
 *
 * Trips are seeded with `seedTrip`, because the criteria start from states
 * the driver API cannot reach on its own (a RELEASED trip with six stops and
 * its orders LOADED is planning's and loading's work, not execution's).
 */
export interface World {
  app: NestExpressApplication;
  db: Database;
  close: () => Promise<void>;
  sfx: string;
  depot: Awaited<ReturnType<typeof depotFixture>>;
  outlets: string[];
  /** Fresh Kadawatha, the first stop of the REF-07 run. */
  kadawatha: string;
  items: { chilled: string; chilledB: string; chilledC: string; dry: string };
  vehicles: { ref: string; dry: string };
  as: Record<Role, { id: string; cookie: string }>;
  /** The audit sequence this test started from; see `auditRows`. */
  auditFrom: number;
}

export type Role =
  | 'aniqa'
  | 'dinushi'
  | 'dispatcher'
  | 'loader'
  | 'store'
  | 'otherStore'
  | 'admin';

export async function buildWorld(): Promise<World> {
  const sfx = suffix();
  const app = await createTestApp();
  const { db, close } = ownerDatabase();
  const depot = await depotFixture(db, sfx);
  await calendarFixture(db);

  const plg = { depotId: depot.plg, districtId: depot.plgDistrict };
  // Kadawatha opens 07:00 and closes 09:00; the rest of the run is 05:30 to
  // 07:30, the fixture default, so a criterion can state a window.
  const kadawatha = await outletFixture(db, `OUTK${sfx}`, plg, {
    name: `Fresh Kadawatha ${sfx}`,
    windowOpenMin: 420,
    windowCloseMin: 540,
  });
  const rest = await Promise.all(
    ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      outletFixture(db, `OUT${letter}${sfx}`, plg, {
        name: `Fresh ${letter} ${sfx}`,
        dockType: letter === 'B' ? 'STREET' : 'REAR_DOCK',
        parkingConstraint: letter === 'B' ? 'VAN_ONLY' : 'NORMAL',
      }),
    ),
  );
  const outlets = [kadawatha, ...rest];
  // D9 Dock and access reads these from the bundle with the network off, so
  // every outlet of the run carries a note and someone to call.
  await db
    .update(outletsTable)
    .set({
      accessNotes: 'Gate 2 after 06:00; reverse in from the lane',
      receivingContactName: 'K. Fernando',
      receivingContactPhone: '+94 71 234 5678',
      address: 'Kandy Road, Kadawatha',
      lat: 7.0014,
      lng: 79.9507,
    })
    .where(inArray(outletsTable.id, outlets));
  const otherOutlet = await outletFixture(db, `OUTZ${sfx}`, plg, {
    name: `Fresh Ja-Ela ${sfx}`,
  });

  // Three chilled items, so a criterion can state an order of three lines.
  const items = {
    chilled: await itemFixture(db, {
      sku: `FR-C${sfx}`,
      name: `Yoghurt ${sfx}`,
      tempClass: 'CHILLED',
    }),
    chilledB: await itemFixture(db, {
      sku: `FR-M${sfx}`,
      name: `Milk ${sfx}`,
      tempClass: 'CHILLED',
    }),
    chilledC: await itemFixture(db, {
      sku: `FR-B${sfx}`,
      name: `Butter ${sfx}`,
      tempClass: 'CHILLED',
    }),
    dry: await itemFixture(db, { sku: `FR-D${sfx}`, name: `Rice ${sfx}` }),
  };

  const vehicleRows = {
    ref: `REF-07-${sfx}`,
    dry: `DRY-31-${sfx}`,
  };
  await db.insert(vehicles).values([
    {
      id: vehicleRows.ref,
      code: vehicleRows.ref,
      registrationNo: `REG-${vehicleRows.ref}`,
      type: 'TRUCK',
      temp: 'REEFER',
      weightCapKg: 3000,
      volumeCapM3: 20,
      fuelType: 'diesel',
      kmPerL: 6,
      weeklyFuelQuotaL: 400,
      depotId: depot.plg,
    },
    {
      id: vehicleRows.dry,
      code: vehicleRows.dry,
      registrationNo: `REG-${vehicleRows.dry}`,
      type: 'TRUCK',
      temp: 'AMBIENT',
      weightCapKg: 3000,
      volumeCapM3: 20,
      fuelType: 'diesel',
      kmPerL: 6,
      weeklyFuelQuotaL: 400,
      depotId: depot.plg,
    },
  ]);

  const signIn = async (
    role: Parameters<typeof signedInAs>[2]['role'],
    input: { name?: string; depotId?: string; outletId?: string } = {},
  ) => {
    const user = await signedInAs(app, db, { role, ...input });
    return { id: user.id, cookie: user.cookie };
  };

  const as: World['as'] = {
    aniqa: await signIn('driver', {
      name: 'Aniqa Razick',
      depotId: depot.plg,
    }),
    dinushi: await signIn('driver', {
      name: 'Dinushi Rathnayake',
      depotId: depot.plg,
    }),
    dispatcher: await signIn('dispatcher', {
      name: 'Tihara Egodage',
      depotId: depot.plg,
    }),
    loader: await signIn('loader', {
      name: 'Harini De Mel',
      depotId: depot.plg,
    }),
    store: await signIn('store_manager', {
      name: 'Nimesha Periyapperuma',
      outletId: kadawatha,
    }),
    otherStore: await signIn('store_manager', { outletId: otherOutlet }),
    admin: await signIn('admin', { name: 'Rusiru Jayawardena' }),
  };

  return {
    app,
    db,
    close,
    sfx,
    depot,
    outlets,
    kadawatha,
    items,
    vehicles: vehicleRows,
    as,
    auditFrom: 0,
  };
}

export async function tearDownWorld(world: World): Promise<void> {
  world.app.get(ClockService).reset();
  await world.close();
  await world.app.close();
}

/** A request as one of the world's people, with the headers a browser sends. */
export function call(
  world: World,
  role: Role,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) {
  return request(world.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set(browser())
    .set('Cookie', world.as[role].cookie);
}

/** The envelope's data, typed the way a criterion reads it. */
export const data = <T>(res: Response): T => (res.body as { data: T }).data;

export interface SeededTrip {
  tripId: string;
  planId: string;
  stopIds: string[];
  orderIds: string[];
  vehicleId: string;
}

/**
 * A trip on a plan with one stop per outlet, each carrying its own LOADED
 * order and lines. Trip status, stop status and the stops' outlets are the
 * criteria's to choose; everything else follows the schema's composite keys
 * (a stop's depot, brand and district must match both its trip and its
 * outlet).
 */
export async function seedTrip(
  world: World,
  input: {
    vehicle?: 'ref' | 'dry';
    driver?: Role;
    date?: string;
    tripNo?: number;
    status?: (typeof trips.$inferInsert)['status'];
    tempClass?: (typeof trips.$inferInsert)['tempClass'];
    /** How many stops, taken from the world's outlets in order. */
    stops?: number;
    stopStatus?: (typeof stops.$inferInsert)['status'];
    /** Units on each of the stop's order lines. */
    qty?: number;
    /** How many lines each stop's order carries (1 to 3). */
    lines?: number;
  } = {},
): Promise<SeededTrip> {
  const date = input.date ?? '2026-10-02';
  const vehicleId = world.vehicles[input.vehicle ?? 'ref'];
  const driverId = world.as[input.driver ?? 'aniqa'].id;
  const tempClass = input.tempClass ?? 'CHILLED';
  const count = input.stops ?? 1;
  const qty = input.qty ?? 10;
  const lineCount = input.lines ?? 1;

  const planId = await planFor(world, date);
  const [trip] = await world.db
    .insert(trips)
    .values({
      planId,
      depotId: world.depot.plg,
      vehicleId,
      driverId,
      tripNo: input.tripNo ?? 1,
      brand: 'FRESH',
      districtId: world.depot.plgDistrict,
      tempClass,
      status: input.status ?? 'RELEASED',
      releasedAt: new Date(`${date}T02:30:00+05:30`),
      plannedDepartAt: new Date(`${date}T03:30:00+05:30`),
    })
    .returning({ id: trips.id });

  const stopIds: string[] = [];
  const orderIds: string[] = [];
  const itemIds = (
    tempClass === 'CHILLED'
      ? [world.items.chilled, world.items.chilledB, world.items.chilledC]
      : [world.items.dry, world.items.chilled, world.items.chilledB]
  ).slice(0, lineCount);
  for (let seq = 1; seq <= count; seq += 1) {
    const outletId = world.outlets[(seq - 1) % world.outlets.length];
    const [order] = await world.db
      .insert(orders)
      .values({
        orderNo: `WF-${world.sfx}${nextSeq()}`,
        outletId,
        depotId: world.depot.plg,
        brand: 'FRESH',
        districtId: world.depot.plgDistrict,
        tempClass,
        requestedDate: date,
        deliveryDate: date,
        status: 'LOADED',
        units: qty * itemIds.length,
        weightKg: qty * 10 * itemIds.length,
        volumeM3: qty * 0.02 * itemIds.length,
        source: 'seed',
        submittedAt: new Date(`${date}T09:00:00+05:30`),
      })
      .returning({ id: orders.id });
    await world.db.insert(orderLines).values(
      itemIds.map((itemId) => ({
        orderId: order.id,
        itemId,
        qty,
        unitWeightKg: 10,
        unitVolumeM3: 0.02,
        unitValueLkr: null,
      })),
    );
    const [stop] = await world.db
      .insert(stops)
      .values({
        tripId: trip.id,
        orderId: order.id,
        outletId,
        depotId: world.depot.plg,
        brand: 'FRESH',
        districtId: world.depot.plgDistrict,
        seq,
        status: input.stopStatus ?? 'PENDING',
        plannedArrivalAt: new Date(`${date}T04:00:00+05:30`),
        plannedServiceMin: 12,
        windowOpenMin: outletId === world.kadawatha ? 420 : 330,
        windowCloseMin: outletId === world.kadawatha ? 540 : 450,
      })
      .returning({ id: stops.id });
    await world.db
      .update(orders)
      .set({ activeStopId: stop.id })
      .where(eq(orders.id, order.id));
    stopIds.push(stop.id);
    orderIds.push(order.id);
  }
  return { tripId: trip.id, planId, stopIds, orderIds, vehicleId };
}

/** One plan per depot and date, however many trips a criterion seeds on it. */
async function planFor(world: World, date: string): Promise<string> {
  const [existing] = await world.db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.depotId, world.depot.plg), eq(plans.date, date)));
  if (existing) return existing.id;
  const [plan] = await world.db
    .insert(plans)
    .values({
      depotId: world.depot.plg,
      date,
      status: 'PUBLISHED',
      revision: 1,
      publishedAt: new Date(`${date}T01:00:00+05:30`),
    })
    .returning({ id: plans.id });
  return plan.id;
}

/** Order numbers for seeded rows; suites share one database. */
let counter = 2000;
const nextSeq = () => String((counter += 1)).padStart(4, '0');

/**
 * Every trip, stop, order and event of this world goes, and the audit mark
 * moves to now, so each test starts from nothing without touching the audit
 * chain other suites share. Outbox rows are a queue, so they are deleted.
 */
export async function resetTrips(world: World): Promise<void> {
  const tripIds = (
    await world.db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.depotId, world.depot.plg))
  ).map((t) => t.id);
  if (tripIds.length) {
    const stopIds = (
      await world.db
        .select({ id: stops.id })
        .from(stops)
        .where(inArray(stops.tripId, tripIds))
    ).map((s) => s.id);
    await world.db
      .delete(stopEvents)
      .where(inArray(stopEvents.tripId, tripIds));
    if (stopIds.length) {
      await world.db
        .delete(deliveryLines)
        .where(inArray(deliveryLines.stopId, stopIds));
      await world.db
        .update(orders)
        .set({ activeStopId: null })
        .where(inArray(orders.activeStopId, stopIds));
      await world.db.delete(stops).where(inArray(stops.id, stopIds));
    }
    await world.db.delete(trips).where(inArray(trips.id, tripIds));
  }
  await world.db.delete(plans).where(eq(plans.depotId, world.depot.plg));
  await world.db.delete(orders).where(eq(orders.depotId, world.depot.plg));
  await world.db
    .delete(outboxEvents)
    .where(eq(outboxEvents.depotId, world.depot.plg));
  world.auditFrom = await lastAuditSeq(world);
}

async function lastAuditSeq(world: World): Promise<number> {
  const [row] = await world.db
    .select({ seq: auditEvents.seq })
    .from(auditEvents)
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  return row?.seq ?? 0;
}

/**
 * The audit rows an action wrote in this test, oldest first.
 *
 * Suites share one database and run in parallel, so "exactly one row" and
 * "no row at all" only mean anything about this world: rows are taken from
 * past the audit mark `resetTrips` set, and from this world's own people.
 */
export async function auditRows(
  world: World,
  action: string,
  entityId?: string,
): Promise<(typeof auditEvents.$inferSelect)[]> {
  return world.db
    .select()
    .from(auditEvents)
    .where(
      and(
        gt(auditEvents.seq, world.auditFrom),
        eq(auditEvents.action, action),
        entityId
          ? eq(auditEvents.entityId, entityId)
          : inArray(
              auditEvents.actorId,
              Object.values(world.as).map((person) => person.id),
            ),
      ),
    )
    .orderBy(asc(auditEvents.seq));
}

/** The outbox events of a type in this world's depot, for the "once" checks. */
export async function outboxRows(
  world: World,
  type: string,
  aggregateId?: string,
): Promise<(typeof outboxEvents.$inferSelect)[]> {
  return world.db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.type, type),
        eq(outboxEvents.depotId, world.depot.plg),
        aggregateId ? eq(outboxEvents.aggregateId, aggregateId) : undefined,
      ),
    )
    .orderBy(asc(outboxEvents.occurredAt));
}

export async function tripRow(
  world: World,
  id: string,
): Promise<typeof trips.$inferSelect> {
  const [row] = await world.db.select().from(trips).where(eq(trips.id, id));
  return row;
}

export async function stopRow(
  world: World,
  id: string,
): Promise<typeof stops.$inferSelect> {
  const [row] = await world.db.select().from(stops).where(eq(stops.id, id));
  return row;
}

export async function orderRow(
  world: World,
  id: string,
): Promise<typeof orders.$inferSelect> {
  const [row] = await world.db.select().from(orders).where(eq(orders.id, id));
  return row;
}

/** This trip's stop events, oldest first: the record the projections follow. */
export async function eventRows(
  world: World,
  tripId: string,
  type?: string,
): Promise<(typeof stopEvents.$inferSelect)[]> {
  const rows = await world.db
    .select()
    .from(stopEvents)
    .where(eq(stopEvents.tripId, tripId))
    .orderBy(asc(stopEvents.occurredAt), asc(stopEvents.id));
  return type ? rows.filter((row) => row.type === type) : rows;
}

export async function deliveryLineRows(
  world: World,
  stopId: string,
): Promise<(typeof deliveryLines.$inferSelect)[]> {
  return world.db
    .select()
    .from(deliveryLines)
    .where(eq(deliveryLines.stopId, stopId));
}

/** The order lines of a stop's order, for building a delivery's `lines`. */
export async function orderLineRows(
  world: World,
  orderId: string,
): Promise<(typeof orderLines.$inferSelect)[]> {
  return world.db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId));
}

/**
 * An order's status, for the criteria that start from one the driver API
 * cannot reach on its own (an order already IN_TRANSIT because its trip left
 * the depot before the test began).
 */
export async function setOrderStatus(
  world: World,
  orderId: string,
  status: (typeof orders.$inferInsert)['status'],
): Promise<void> {
  await world.db.update(orders).set({ status }).where(eq(orders.id, orderId));
}

/**
 * The stops in a new order, as 19b Re-sequence would leave them. Planning
 * owns the endpoint; a criterion about what the driver then sees starts from
 * its result.
 */
export async function resequence(
  world: World,
  stopIdsInOrder: readonly string[],
): Promise<void> {
  // Two passes, because (tripId, seq) is unique.
  await Promise.all(
    stopIdsInOrder.map((id, index) =>
      world.db
        .update(stops)
        .set({ seq: -(index + 1) })
        .where(eq(stops.id, id)),
    ),
  );
  for (const [index, id] of stopIdsInOrder.entries())
    await world.db
      .update(stops)
      .set({ seq: index + 1 })
      .where(eq(stops.id, id));
}

/** A stop deferred mid-route: cancelled, never deleted, and its seq freed. */
export async function cancelStop(world: World, stopId: string): Promise<void> {
  await world.db
    .update(stops)
    .set({ status: 'CANCELLED', seq: null, cancelledReason: 'DEFERRED' })
    .where(eq(stops.id, stopId));
}

/** Freezes the demo clock, the way every criterion states a time. */
export function at(world: World, instant: string): void {
  freezeClock(world.app, instant);
}
