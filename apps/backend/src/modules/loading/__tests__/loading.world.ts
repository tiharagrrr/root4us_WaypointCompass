import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import request, { type Response } from 'supertest';
import { uuidv7 } from 'uuidv7';
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
import type { Actor, UserRole } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { JobContextRunner } from '../../../core/context/job-context';
import type { Database } from '../../../db/client';
import {
  auditEvents,
  deferralReasons,
  deferrals,
  depotWaves,
  loadCheckLines,
  loadFlags,
  loadReleases,
  orderLines,
  orders,
  outboxEvents,
  planRevisions,
  plans,
  stops,
  trips,
  users,
  vehicles,
} from '../../../db/schema';
import type { DeliveredEvent } from '../domain/event-payloads';
import type { BatchResult, LoaderEvent } from '../domain/loader-event';
import { LoaderEventService } from '../services/loader-event.service';
import {
  type HandledEvent,
  LoadListBuilder,
} from '../services/load-list-builder.service';

/**
 * The world every loading suite runs in, built once per suite from hand-made
 * rows (the competition datasets stay out of tests, see
 * specs/data/datasets.md):
 *
 * - depot PLG with one district and one wave, Kandy with its own, and the
 *   demo calendar for 2026-09-28 to 2026-10-04;
 * - six Fresh outlets on the Gampaha run, Fresh Kadawatha first, so a
 *   criterion can say "six stop groups in the order 6, 5, 4, 3, 2, 1";
 * - REF-07, a reefer, and DRY-31, an ambient truck, both at PLG;
 * - loader Harini De Mel and a second loader on another tablet; dispatcher
 *   Tihara Egodage over every depot and one scoped to Kandy; driver Aniqa
 *   Razick, store manager Nimesha Periyapperuma at Fresh Kadawatha, and an
 *   admin — because the permission matrix is the subject of AC-LOD-03;
 * - the deferral reasons a REMOVE needs.
 *
 * Trips are seeded with `seedTrip`, because every criterion starts from a
 * state planning reaches and loading does not: a PLANNED trip with six stops,
 * each carrying its own PLANNED order and lines. Then `publish()` delivers
 * `plan.published` the way the outbox relay will, and the dock has a list.
 */
export interface World {
  app: NestExpressApplication;
  db: Database;
  close: () => Promise<void>;
  sfx: string;
  depot: Awaited<ReturnType<typeof depotFixture>>;
  /** The outlets of the Gampaha run, Fresh Kadawatha first. */
  outlets: string[];
  kadawatha: string;
  items: { chilled: string; chilledB: string; chilledC: string; dry: string };
  vehicles: { ref: string; dry: string };
  waves: { run1: string; run2: string };
  reasons: { capacity: string; damaged: string };
  as: Record<Role, { id: string; cookie: string }>;
  /** The audit sequence this test started from; see `auditRows`. */
  auditFrom: number;
}

export type Role =
  /** Harini De Mel, loader at Peliyagoda. */
  | 'harini'
  /** A second loader, on a second tablet at the same dock. */
  | 'loader2'
  /** Tihara Egodage, dispatcher over every depot. */
  | 'tihara'
  /** A dispatcher scoped to Kandy, who must see none of this. */
  | 'kandy'
  | 'driver'
  | 'store'
  | 'admin';

/** The business date every criterion loads on. */
export const DAY = '2026-10-02';

export async function buildWorld(): Promise<World> {
  const sfx = suffix();
  const app = await createTestApp();
  const { db, close } = ownerDatabase();
  const depot = await depotFixture(db, sfx);
  await calendarFixture(db);

  const plg = { depotId: depot.plg, districtId: depot.plgDistrict };
  const kadawatha = await outletFixture(db, `OUTK${sfx}`, plg, {
    name: `Fresh Kadawatha ${sfx}`,
    windowOpenMin: 420,
    windowCloseMin: 540,
  });
  const rest = await Promise.all(
    ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      outletFixture(db, `OUT${letter}${sfx}`, plg, {
        name: `Fresh ${letter} ${sfx}`,
      }),
    ),
  );
  const outlets = [kadawatha, ...rest];

  const items = {
    chilled: await itemFixture(db, {
      sku: `FR-A${sfx}`,
      name: `Yoghurt ${sfx}`,
      tempClass: 'CHILLED',
    }),
    chilledB: await itemFixture(db, {
      sku: `FR-B${sfx}`,
      name: `Milk ${sfx}`,
      tempClass: 'CHILLED',
    }),
    chilledC: await itemFixture(db, {
      sku: `FR-C${sfx}`,
      name: `Butter ${sfx}`,
      tempClass: 'CHILLED',
    }),
    dry: await itemFixture(db, { sku: `FR-D${sfx}`, name: `Rice ${sfx}` }),
  };

  const vehicleIds = { ref: `REF-07-${sfx}`, dry: `DRY-31-${sfx}` };
  await db.insert(vehicles).values(
    (['ref', 'dry'] as const).map((key) => ({
      id: vehicleIds[key],
      code: vehicleIds[key],
      registrationNo: `REG-${vehicleIds[key]}`,
      type: 'TRUCK' as const,
      temp: key === 'ref' ? ('REEFER' as const) : ('AMBIENT' as const),
      weightCapKg: 3000,
      volumeCapM3: 20,
      fuelType: 'diesel',
      kmPerL: 6,
      weeklyFuelQuotaL: 400,
      depotId: depot.plg,
    })),
  );

  // Two waves, so AC-LOD-02 can ask for one and get only its trips.
  const waveRows = await db
    .insert(depotWaves)
    .values([
      {
        depotId: depot.plg,
        label: `Run 1 ${sfx}`,
        departFromMin: 195,
        departToMin: 225,
        brands: ['FRESH'],
      },
      {
        depotId: depot.plg,
        label: `Run 2 ${sfx}`,
        departFromMin: 315,
        departToMin: 345,
        brands: ['FRESH'],
      },
    ])
    .returning({ id: depotWaves.id, label: depotWaves.label });
  const waves = {
    run1: waveRows.find((w) => w.label.startsWith('Run 1'))!.id,
    run2: waveRows.find((w) => w.label.startsWith('Run 2'))!.id,
  };

  // A REMOVE needs an active reason code; A6 owns the list.
  const reasons = {
    capacity: `REEFER_CAPACITY_${sfx}`,
    damaged: `DAMAGED_${sfx}`,
  };
  await db.insert(deferralReasons).values([
    { code: reasons.capacity, label: 'No reefer capacity', fromEngine: true },
    { code: reasons.damaged, label: 'Damaged at the dock' },
  ]);

  const signIn = async (
    role: Parameters<typeof signedInAs>[2]['role'],
    input: { name?: string; depotId?: string | null; outletId?: string } = {},
  ) => {
    const user = await signedInAs(app, db, { role, ...input });
    return { id: user.id, cookie: user.cookie };
  };

  const as: World['as'] = {
    harini: await signIn('loader', {
      name: 'Harini De Mel',
      depotId: depot.plg,
    }),
    loader2: await signIn('loader', {
      name: 'Sanduni Perera',
      depotId: depot.plg,
    }),
    tihara: await signIn('dispatcher', {
      name: 'Tihara Egodage',
      depotId: null,
    }),
    kandy: await signIn('dispatcher', {
      name: 'Kandy dispatcher',
      depotId: depot.kdy,
    }),
    driver: await signIn('driver', {
      name: 'Aniqa Razick',
      depotId: depot.plg,
    }),
    store: await signIn('store_manager', {
      name: 'Nimesha Periyapperuma',
      outletId: kadawatha,
    }),
    admin: await signIn('admin', { name: 'Rusiru Withanage' }),
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
    vehicles: vehicleIds,
    waves,
    reasons,
    as,
    auditFrom: 0,
  };
}

export async function closeWorld(world: World): Promise<void> {
  world.app.get(ClockService).reset();
  await world.app.close();
  await world.close();
}

/** The dock tablet every loader request in these suites comes from. */
export const DOCK_TABLET = 'dock-tablet-1';

/**
 * A request as one of the world's people, with the headers a browser sends,
 * plus the `x-device-id` the web client puts on every call — the dock's
 * checks record which tablet they came from, so without it the criteria
 * could not assert that they do.
 */
export function call(
  world: World,
  role: Role,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: Record<string, unknown>,
) {
  const req = request(world.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set(browser())
    .set('x-device-id', DOCK_TABLET)
    .set('Cookie', world.as[role].cookie);
  return method === 'get' ? req : req.send(body ?? {});
}

/** The envelope's data, typed the way a criterion reads it. */
export const data = <T>(res: Response): T => (res.body as { data: T }).data;
/** The envelope's page meta, for the flag queue's totals. */
export const meta = (res: Response) =>
  (res.body as { meta: { page?: { total: number } } }).meta;

export const anId = () => uuidv7();

/** Freezes the demo clock, the way every criterion states a time. */
export function at(world: World, instant: string): void {
  freezeClock(world.app, instant);
}

export interface SeededTrip {
  tripId: string;
  planId: string;
  /** Stop ids by seq, index 0 being seq 1 (Fresh Kadawatha). */
  stopIds: string[];
  orderIds: string[];
  orderNos: string[];
  /** Order line ids per stop, in the order the items were added. */
  lineIds: string[][];
  vehicleId: string;
}

/**
 * A trip on a plan with one stop per outlet, each carrying its own PLANNED
 * order and lines — the state planning leaves behind when it builds a plan,
 * before it is published. Stop 1 is Fresh Kadawatha, so the last-stop-first
 * order is testable.
 */
export async function seedTrip(
  world: World,
  input: {
    vehicle?: 'ref' | 'dry';
    driver?: Role | null;
    date?: string;
    tripNo?: number;
    status?: (typeof trips.$inferInsert)['status'];
    tempClass?: (typeof trips.$inferInsert)['tempClass'];
    wave?: 'run1' | 'run2' | null;
    /** How many stops, taken from the world's outlets in order. */
    stops?: number;
    /** Units on each of the stop's order lines. */
    qty?: number;
    /** How many lines each stop's order carries (1 to 3). */
    lines?: number;
  } = {},
): Promise<SeededTrip> {
  const date = input.date ?? DAY;
  // A vehicle takes at most two trips a day (`trips_vehicle_slot_uq`), and a
  // criterion may want three or four trips on one plan, so each seeded trip
  // gets a reefer of its own unless it asks for one of the world's named
  // vehicles by name.
  const vehicleId = input.vehicle
    ? world.vehicles[input.vehicle]
    : await freshVehicle(world);
  const driverId =
    input.driver === null ? null : world.as[input.driver ?? 'driver'].id;
  const tempClass = input.tempClass ?? 'CHILLED';
  const count = input.stops ?? 1;
  const qty = input.qty ?? 12;
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
      status: input.status ?? 'PLANNED',
      waveId: input.wave === null ? null : world.waves[input.wave ?? 'run1'],
      plannedDepartAt: new Date(`${date}T03:30:00+05:30`),
    })
    .returning({ id: trips.id });

  const itemIds = [
    world.items.chilled,
    world.items.chilledB,
    world.items.chilledC,
  ].slice(0, lineCount);
  const seeded: SeededTrip = {
    tripId: trip.id,
    planId,
    stopIds: [],
    orderIds: [],
    orderNos: [],
    lineIds: [],
    vehicleId,
  };

  for (let seq = 1; seq <= count; seq += 1) {
    const outletId = world.outlets[(seq - 1) % world.outlets.length];
    const orderNo = `WF-${world.sfx}${nextSeq()}`;
    const [order] = await world.db
      .insert(orders)
      .values({
        orderNo,
        outletId,
        depotId: world.depot.plg,
        brand: 'FRESH',
        districtId: world.depot.plgDistrict,
        tempClass,
        requestedDate: date,
        deliveryDate: date,
        status: 'PLANNED',
        units: qty * itemIds.length,
        weightKg: qty * 10 * itemIds.length,
        volumeM3: qty * 0.02 * itemIds.length,
        source: 'seed',
        submittedAt: new Date(`${date}T09:00:00+05:30`),
        confirmedAt: new Date(`${date}T16:00:00+05:30`),
      })
      .returning({ id: orders.id });
    const lines = await world.db
      .insert(orderLines)
      .values(
        itemIds.map((itemId) => ({
          orderId: order.id,
          itemId,
          qty,
          unitWeightKg: 10,
          unitVolumeM3: 0.02,
          unitValueLkr: null,
        })),
      )
      .returning({ id: orderLines.id });
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
        status: 'PENDING',
        plannedArrivalAt: new Date(`${date}T04:10:00+05:30`),
        plannedServiceMin: 12,
        windowOpenMin: outletId === world.kadawatha ? 420 : 330,
        windowCloseMin: outletId === world.kadawatha ? 540 : 450,
      })
      .returning({ id: stops.id });
    await world.db
      .update(orders)
      .set({ activeStopId: stop.id })
      .where(eq(orders.id, order.id));
    seeded.stopIds.push(stop.id);
    seeded.orderIds.push(order.id);
    seeded.orderNos.push(orderNo);
    seeded.lineIds.push(lines.map((line) => line.id));
  }
  return seeded;
}

/**
 * A trip at Kandy, built straight into the database. Nothing in loading can
 * create one, and the criteria only need it to exist so that asking for it
 * answers 404 (AC-LOD-02). It survives `reset`, which clears Peliyagoda
 * alone, so each call adds its own vehicle and trip to the one Kandy plan.
 */
export async function seedOtherDepotTrip(world: World): Promise<string> {
  const vehicleId = `KDY-${world.sfx}-${nextSeq()}`;
  await world.db.insert(vehicles).values({
    id: vehicleId,
    code: vehicleId,
    registrationNo: `REG-${vehicleId}`,
    type: 'TRUCK',
    temp: 'REEFER',
    weightCapKg: 3000,
    volumeCapM3: 20,
    fuelType: 'diesel',
    kmPerL: 6,
    weeklyFuelQuotaL: 400,
    depotId: world.depot.kdy,
  });
  const [existing] = await world.db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.depotId, world.depot.kdy), eq(plans.date, DAY)));
  const planId =
    existing?.id ??
    (
      await world.db
        .insert(plans)
        .values({
          depotId: world.depot.kdy,
          date: DAY,
          status: 'PUBLISHED',
          revision: 1,
        })
        .returning({ id: plans.id })
    )[0].id;
  const [trip] = await world.db
    .insert(trips)
    .values({
      planId,
      depotId: world.depot.kdy,
      vehicleId,
      tripNo: 1,
      brand: 'FRESH',
      districtId: world.depot.kdyDistrict,
      tempClass: 'CHILLED',
      status: 'PLANNED',
    })
    .returning({ id: trips.id });
  return trip.id;
}

/** A reefer of its own for a seeded trip, so vehicle slots never collide. */
async function freshVehicle(world: World): Promise<string> {
  const id = `REF-${world.sfx}-${nextSeq()}`;
  await world.db.insert(vehicles).values({
    id,
    code: id,
    registrationNo: `REG-${id}`,
    type: 'TRUCK',
    temp: 'REEFER',
    weightCapKg: 3000,
    volumeCapM3: 20,
    fuelType: 'diesel',
    kmPerL: 6,
    weeklyFuelQuotaL: 400,
    depotId: world.depot.plg,
  });
  return id;
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
    .values({ depotId: world.depot.plg, date, status: 'DRAFT', revision: 0 })
    .returning({ id: plans.id });
  return plan.id;
}

/** Order numbers for seeded rows; suites share one database. */
let counter = 5000;
const nextSeq = () => String((counter += 1)).padStart(4, '0');

/**
 * One event, delivered the way the outbox relay (ROO-24) will deliver it: a
 * single row, in a job context stamped as the system, in its own
 * transaction. The returned event id is what a redelivery has to repeat.
 */
export async function deliver(
  world: World,
  event: Partial<DeliveredEvent> & { type: string; payload: unknown },
): Promise<HandledEvent & { eventId: string }> {
  const row: DeliveredEvent = {
    id: event.id ?? anId(),
    depotId: event.depotId ?? world.depot.plg,
    occurredAt: event.occurredAt ?? world.app.get(ClockService).now(),
    type: event.type,
    payload: event.payload,
  };
  const builder = world.app.get(LoadListBuilder);
  const handled = await world.app
    .get(JobContextRunner)
    .run({ id: `test:relay:${row.id}` }, () => builder.handle(row));
  return { ...handled, eventId: row.id };
}

/**
 * The plan published: its revision goes to 1 and `plan.published` is
 * delivered for the trips given. This is what every criterion that starts
 * "given the published plan" does.
 */
export async function publish(
  world: World,
  seeded: { planId: string; tripId: string },
  input: { revision?: number; tripIds?: string[]; eventId?: string } = {},
): Promise<HandledEvent & { eventId: string }> {
  const revision = input.revision ?? 1;
  await world.db
    .update(plans)
    .set({
      status: 'PUBLISHED',
      revision,
      publishedAt: world.app.get(ClockService).now(),
    })
    .where(eq(plans.id, seeded.planId));
  return deliver(world, {
    id: input.eventId,
    type: 'plan.published',
    payload: {
      v: 1,
      planId: seeded.planId,
      depotId: world.depot.plg,
      date: DAY,
      revision,
      tripIds: input.tripIds ?? [seeded.tripId],
    },
  });
}

/** The plan revised: its revision moves on and `plan.revised` is delivered. */
export async function revise(
  world: World,
  seeded: { planId: string; tripId: string },
  input: { revision?: number; tripIds?: string[]; reasonCode?: string } = {},
): Promise<HandledEvent & { eventId: string }> {
  const [plan] = await world.db
    .select({ revision: plans.revision })
    .from(plans)
    .where(eq(plans.id, seeded.planId));
  const revision = input.revision ?? plan.revision + 1;
  await world.db
    .update(plans)
    .set({ revision })
    .where(eq(plans.id, seeded.planId));
  return deliver(world, {
    type: 'plan.revised',
    payload: {
      v: 1,
      planId: seeded.planId,
      depotId: world.depot.plg,
      date: DAY,
      revision,
      tripIds: input.tripIds ?? [seeded.tripId],
      reasonCode: input.reasonCode ?? 'DISPATCHER_EDIT',
    },
  });
}

/** The lines of a trip, last stop first then by id, as the list reads. */
export function lineRows(
  world: World,
  tripId: string,
): Promise<(typeof loadCheckLines.$inferSelect)[]> {
  return world.db
    .select()
    .from(loadCheckLines)
    .where(eq(loadCheckLines.tripId, tripId))
    .orderBy(desc(loadCheckLines.stopSeq), asc(loadCheckLines.id));
}

export async function lineRow(
  world: World,
  id: string,
): Promise<typeof loadCheckLines.$inferSelect> {
  const [row] = await world.db
    .select()
    .from(loadCheckLines)
    .where(eq(loadCheckLines.id, id));
  return row;
}

export function flagRows(
  world: World,
  tripId: string,
): Promise<(typeof loadFlags.$inferSelect)[]> {
  return world.db
    .select()
    .from(loadFlags)
    .where(eq(loadFlags.tripId, tripId))
    .orderBy(asc(loadFlags.raisedAt), asc(loadFlags.id));
}

export async function flagRow(
  world: World,
  id: string,
): Promise<typeof loadFlags.$inferSelect> {
  const [row] = await world.db
    .select()
    .from(loadFlags)
    .where(eq(loadFlags.id, id));
  return row;
}

export async function tripRow(
  world: World,
  id: string,
): Promise<typeof trips.$inferSelect> {
  const [row] = await world.db.select().from(trips).where(eq(trips.id, id));
  return row;
}

export async function orderRow(
  world: World,
  id: string,
): Promise<typeof orders.$inferSelect> {
  const [row] = await world.db.select().from(orders).where(eq(orders.id, id));
  return row;
}

export async function planRow(
  world: World,
  id: string,
): Promise<typeof plans.$inferSelect> {
  const [row] = await world.db.select().from(plans).where(eq(plans.id, id));
  return row;
}

export async function releaseRow(
  world: World,
  tripId: string,
): Promise<typeof loadReleases.$inferSelect | undefined> {
  const [row] = await world.db
    .select()
    .from(loadReleases)
    .where(eq(loadReleases.tripId, tripId));
  return row;
}

/** The deferrals for an order, for AC-LOD-12. */
export function deferralRows(
  world: World,
  orderId: string,
): Promise<(typeof deferrals.$inferSelect)[]> {
  return world.db
    .select()
    .from(deferrals)
    .where(eq(deferrals.orderId, orderId))
    .orderBy(asc(deferrals.createdAt));
}

/** The backorders raised from an order, for AC-LOD-12. */
export function backorderRows(
  world: World,
  parentOrderId: string,
): Promise<(typeof orders.$inferSelect)[]> {
  return world.db
    .select()
    .from(orders)
    .where(eq(orders.parentOrderId, parentOrderId));
}

export function revisionRows(
  world: World,
  planId: string,
): Promise<(typeof planRevisions.$inferSelect)[]> {
  return world.db
    .select()
    .from(planRevisions)
    .where(eq(planRevisions.planId, planId))
    .orderBy(asc(planRevisions.revision));
}

/**
 * The audit rows an action wrote in this test, oldest first.
 *
 * Suites share one database and run in parallel, so "exactly one row" and "no
 * row at all" only mean anything about this world: rows are taken from past
 * the audit mark `reset` set, and from this world's own people.
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
          : // Without an entity, the rows are this world's people's. Suites
            // run in parallel against one database, so "exactly one row"
            // would otherwise count another world's loader as well.
            inArray(
              auditEvents.actorId,
              Object.values(world.as).map((person) => person.id),
            ),
      ),
    )
    .orderBy(asc(auditEvents.seq));
}

/** The outbox events of a type in this world's depot, for the "once" checks. */
export function outboxRows(
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
    .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id));
}

/**
 * Every trip, list, flag, release, order and event of this world goes, and
 * the audit mark moves to now, so each test starts from nothing without
 * touching the audit chain other suites share. Outbox rows and receipts are
 * queues, so they are deleted.
 */
export async function reset(world: World): Promise<void> {
  const tripIds = (
    await world.db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.depotId, world.depot.plg))
  ).map((trip) => trip.id);
  if (tripIds.length) {
    await world.db.delete(loadFlags).where(inArray(loadFlags.tripId, tripIds));
    await world.db
      .delete(loadReleases)
      .where(inArray(loadReleases.tripId, tripIds));
    await world.db
      .delete(loadCheckLines)
      .where(inArray(loadCheckLines.tripId, tripIds));
    const stopIds = (
      await world.db
        .select({ id: stops.id })
        .from(stops)
        .where(inArray(stops.tripId, tripIds))
    ).map((stop) => stop.id);
    if (stopIds.length) {
      await world.db
        .update(orders)
        .set({ activeStopId: null })
        .where(inArray(orders.activeStopId, stopIds));
      await world.db.delete(stops).where(inArray(stops.id, stopIds));
    }
    await world.db.delete(trips).where(inArray(trips.id, tripIds));
  }
  const planIds = (
    await world.db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.depotId, world.depot.plg))
  ).map((plan) => plan.id);
  if (planIds.length) {
    await world.db.delete(deferrals).where(inArray(deferrals.planId, planIds));
    await world.db
      .delete(planRevisions)
      .where(inArray(planRevisions.planId, planIds));
  }
  const orderIds = (
    await world.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.depotId, world.depot.plg))
  ).map((order) => order.id);
  if (orderIds.length) {
    await world.db
      .delete(orderLines)
      .where(inArray(orderLines.orderId, orderIds));
    await world.db
      .update(orders)
      .set({ parentOrderId: null })
      .where(inArray(orders.id, orderIds));
    await world.db.delete(orders).where(inArray(orders.id, orderIds));
  }
  await world.db.delete(plans).where(eq(plans.depotId, world.depot.plg));
  await world.db
    .delete(outboxEvents)
    .where(eq(outboxEvents.depotId, world.depot.plg));
  // `load_event_receipts` is deliberately left alone. Event ids are UUIDv7,
  // so no two runs share one, and clearing the table would wipe the receipts
  // of a suite running beside this one — which is exactly what AC-LOD-01's
  // redelivery check reads.
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
 * One of the world's people as an `Actor`, for a service called in process
 * rather than over HTTP — which is how `POST /sync` (ROO-44) will call
 * `LoaderEventService`, and so how AC-LOD-18 drives it.
 */
async function actorOf(world: World, role: Role): Promise<Actor> {
  const [row] = await world.db
    .select()
    .from(users)
    .where(eq(users.id, world.as[role].id));
  return {
    id: row.id,
    name: row.name,
    role: row.role as UserRole,
    depotId: row.depotId,
    outletId: row.outletId,
    vehicleId: row.defaultVehicleId,
    deviceId: DOCK_TABLET,
  };
}

/**
 * A queued loader batch replayed the way `POST /sync` will replay one: in a
 * context carrying the loader for the audit rows and the system for
 * row-level security, in one transaction.
 */
export async function syncAsLoader(
  world: World,
  events: readonly LoaderEvent[],
  role: Role = 'harini',
): Promise<BatchResult[]> {
  const actor = await actorOf(world, role);
  const service = world.app.get(LoaderEventService);
  return world.app
    .get(JobContextRunner)
    .run({ id: `test:sync:${anId()}`, actor }, () =>
      service.applyMany(events, actor),
    );
}

/**
 * One tap on the tablet, as a stable clientUuid. A criterion needs to be
 * able to repeat one exactly, because a replay is only a replay if it
 * carries the same uuid — so these are chosen, not random.
 *
 * The world's suffix goes in the last field. `clientUuid` is unique across
 * the whole of `load_check_lines`, `load_flags` and `load_releases`, and
 * suites share one local database, so a uuid built from `n` alone would
 * collide with the previous run's rows and come back as a duplicate.
 */
export const tapUuid = (world: World, n: number): string =>
  `00000000-0000-4000-8000-${world.sfx.padStart(6, '0')}${String(n).padStart(6, '0')}`;

/**
 * Checks every line of a trip OK, the way a loader would before release, and
 * fails the test when any item was refused — a helper that silently checked
 * nothing would turn a real bug into a confusing release failure.
 */
export async function checkEverything(
  world: World,
  tripId: string,
  from = 100,
): Promise<Response> {
  // Only what still needs a loader: a line already OK would be refused as
  // not checkable, which would make this helper hide a real failure.
  const lines = (await lineRows(world, tripId)).filter(
    (line) => line.status === 'PENDING',
  );
  if (lines.length === 0)
    return call(world, 'harini', 'get', `/trips/${tripId}/load-list`);
  const res = await call(
    world,
    'harini',
    'post',
    `/trips/${tripId}/load-list/checks`,
    {
      checks: lines.map((line, index) => ({
        lineId: line.id,
        qtyLoaded: line.qtyExpected,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(world, from + index),
        checkedAt: '2026-10-02T02:45:10+05:30',
      })),
    },
  );
  expect(res.status).toBe(200);
  expect(data<{ applied: number }>(res)).toMatchObject({
    applied: lines.length,
  });
  return res;
}

/** The structured part of one log line: `{ event, ...ids }`. */
export type LogLine = Record<string, unknown>;

export interface CapturedLogs {
  withEvent: (event: string) => LogLine[];
  restore: () => void;
}

/**
 * Captures what the module logs, so a criterion naming a log line and the
 * fields it carries can assert them (AC-LOD-01, AC-LOD-16).
 *
 * The spy is on `PinoLogger.prototype`, so it sees exactly the object the
 * code passed. Call `restore()` in afterEach, or the spy outlives the test.
 */
export function captureLogs(): CapturedLogs {
  const lines: LogLine[] = [];
  const spies = (['info', 'warn', 'debug'] as const).map((level) =>
    jest
      .spyOn(PinoLogger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        const [first] = args;
        if (first && typeof first === 'object') lines.push(first as LogLine);
      }),
  );
  return {
    withEvent: (event) => lines.filter((line) => line.event === event),
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
