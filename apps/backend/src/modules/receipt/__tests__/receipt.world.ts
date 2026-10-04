import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, desc, eq, gt, inArray, or } from 'drizzle-orm';
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
  attachments,
  auditEvents,
  comments,
  deliveryLines,
  issues,
  orderLines,
  orders,
  outboxEvents,
  plans,
  receiptLines,
  receipts,
  stops,
  trips,
  vehicles,
} from '../../../db/schema';

/**
 * The world every receipt suite runs in, built once per suite from hand-made rows (the
 * competition datasets stay out of tests, see specs/data/datasets.md):
 *
 * - depots PLG and KDY, each with one district, and the demo calendar;
 * - Fresh Kadawatha, a second Fresh outlet at PLG and a Fresh outlet at KDY;
 * - three dry Fresh items, so an order can carry three lines;
 * - Nimesha, the store manager at Fresh Kadawatha, and a store manager at the other
 *   outlet; Tihara, a dispatcher for every depot; a dispatcher scoped to KDY; Aniqa and
 *   another driver; Harini the loader; and an admin.
 *
 * Deliveries are seeded with `seedDelivery`, because the criteria start from states the
 * driver API reaches in execution's suites, not here: a DELIVERED stop with its lines, an
 * order at a chosen version, a proof of delivery.
 */
export interface World {
  app: NestExpressApplication;
  db: Database;
  close: () => Promise<void>;
  sfx: string;
  depot: Awaited<ReturnType<typeof depotFixture>>;
  kadawatha: string;
  otherOutlet: string;
  kandyOutlet: string;
  items: { rice: string; oil: string; lentils: string };
  vehicleId: string;
  as: Record<Role, { id: string; cookie: string }>;
  /** The audit sequence this test started from; see `auditRows`. */
  auditFrom: number;
}

export type Role =
  | 'store'
  | 'otherStore'
  | 'dispatcher'
  | 'kandyDispatcher'
  | 'driver'
  | 'otherDriver'
  | 'loader'
  | 'admin';

export async function buildWorld(): Promise<World> {
  const sfx = suffix();
  const app = await createTestApp();
  const { db, close } = ownerDatabase();
  const depot = await depotFixture(db, sfx);
  await calendarFixture(db);

  const plg = { depotId: depot.plg, districtId: depot.plgDistrict };
  const kdy = { depotId: depot.kdy, districtId: depot.kdyDistrict };
  const kadawatha = await outletFixture(db, `OUTK${sfx}`, plg, {
    name: `Fresh Kadawatha ${sfx}`,
  });
  const otherOutlet = await outletFixture(db, `OUTZ${sfx}`, plg, {
    name: `Fresh Ja-Ela ${sfx}`,
  });
  const kandyOutlet = await outletFixture(db, `OUTY${sfx}`, kdy, {
    name: `Fresh Peradeniya ${sfx}`,
  });

  const items = {
    rice: await itemFixture(db, {
      sku: `FR-R${sfx}`,
      name: `Basmati rice 5 kg ${sfx}`,
      packLabel: 'Bag ×4',
    }),
    oil: await itemFixture(db, {
      sku: `FR-O${sfx}`,
      name: `Coconut oil 1 L ${sfx}`,
      packLabel: 'Case ×12',
    }),
    lentils: await itemFixture(db, {
      sku: `FR-L${sfx}`,
      name: `Red lentils 1 kg ${sfx}`,
      packLabel: 'Case ×10',
    }),
  };

  const vehicleId = `DRY-31-${sfx}`;
  await db.insert(vehicles).values({
    id: vehicleId,
    code: vehicleId,
    registrationNo: `REG-${vehicleId}`,
    type: 'TRUCK',
    temp: 'AMBIENT',
    weightCapKg: 3000,
    volumeCapM3: 20,
    fuelType: 'diesel',
    kmPerL: 6,
    weeklyFuelQuotaL: 400,
    depotId: depot.plg,
  });

  const signIn = async (
    role: Parameters<typeof signedInAs>[2]['role'],
    input: { name?: string; depotId?: string; outletId?: string } = {},
  ) => {
    const user = await signedInAs(app, db, { role, ...input });
    return { id: user.id, cookie: user.cookie };
  };

  const as: World['as'] = {
    store: await signIn('store_manager', {
      name: 'Nimesha Periyapperuma',
      outletId: kadawatha,
    }),
    otherStore: await signIn('store_manager', { outletId: otherOutlet }),
    // No depot: every depot, as the criteria say of Tihara.
    dispatcher: await signIn('dispatcher', { name: 'Tihara Egodage' }),
    kandyDispatcher: await signIn('dispatcher', {
      name: 'Kandy Dispatcher',
      depotId: depot.kdy,
    }),
    driver: await signIn('driver', {
      name: 'Aniqa Razick',
      depotId: depot.plg,
    }),
    otherDriver: await signIn('driver', {
      name: 'Dinushi Rathnayake',
      depotId: depot.plg,
    }),
    loader: await signIn('loader', {
      name: 'Harini De Mel',
      depotId: depot.plg,
    }),
    admin: await signIn('admin', { name: 'Rusiru Jayawardena' }),
  };

  return {
    app,
    db,
    close,
    sfx,
    depot,
    kadawatha,
    otherOutlet,
    kandyOutlet,
    items,
    vehicleId,
    as,
    auditFrom: 0,
  };
}

export async function tearDownWorld(world: World): Promise<void> {
  world.app.get(ClockService).reset();
  await world.close();
  await world.app.close();
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A request as one of the world's people, with the headers a browser sends. */
export function call(
  world: World,
  role: Role,
  method: Method,
  path: string,
  init: { ifMatch?: number | string; key?: string; body?: object } = {},
) {
  let req = request(world.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set(browser())
    .set('Cookie', world.as[role].cookie);
  if (init.ifMatch !== undefined)
    req = req.set(
      'If-Match',
      typeof init.ifMatch === 'number' ? `W/"${init.ifMatch}"` : init.ifMatch,
    );
  // Keys are stored for a day and bound to a user, and every run signs in new people, so
  // they are scoped to this world.
  if (init.key) req = req.set('Idempotency-Key', `${world.sfx}:${init.key}`);
  return init.body ? req.send(init.body) : req;
}

/** The envelope's data, typed the way a criterion reads it. */
export const data = <T>(res: Response): T => (res.body as { data: T }).data;

export interface SeededDelivery {
  orderId: string;
  orderNo: string;
  stopId: string;
  tripId: string;
  /** The order's line ids, in the order they were given. */
  lineIds: string[];
}

export interface DeliveryInput {
  /** Defaults to DELIVERED. */
  orderStatus?: (typeof orders.$inferInsert)['status'];
  /** The order's version; defaults to 8, as the criteria say. */
  version?: number;
  stopStatus?: (typeof stops.$inferInsert)['status'];
  /** The stop's ETA; defaults to 04:10 on the delivery day. */
  etaAt?: string | null;
  /** When the driver completed the stop; defaults to 04:22 when it is DELIVERED or PARTIAL. */
  completedAt?: string | null;
  /** One entry per order line; `delivered: null` means the driver's record has not synced. */
  lines?: { expected: number; delivered: number | null }[];
  receiverName?: string | null;
  /** Whose trip it is. */
  driver?: Role;
  date?: string;
  /** A signature and a photo the driver uploaded. */
  proofFiles?: boolean;
}

let counter = 3000;
const nextSeq = () => String((counter += 1)).padStart(4, '0');

/**
 * An order for Fresh Kadawatha on a trip, with a stop in the state a criterion starts from,
 * its delivery lines and, if asked, the proof of delivery the driver captured. Everything
 * else follows the schema's composite keys.
 */
export async function seedDelivery(
  world: World,
  input: DeliveryInput = {},
): Promise<SeededDelivery> {
  const date = input.date ?? '2026-10-02';
  const lines = input.lines ?? [
    { expected: 12, delivered: 12 },
    { expected: 12, delivered: 12 },
    { expected: 12, delivered: 12 },
  ];
  const itemIds = [world.items.rice, world.items.oil, world.items.lentils];
  const stopStatus = input.stopStatus ?? 'DELIVERED';
  const finished = stopStatus === 'DELIVERED' || stopStatus === 'PARTIAL';
  const driverId = world.as[input.driver ?? 'driver'].id;
  const units = lines.reduce((sum, l) => sum + l.expected, 0);

  const planId = await planFor(world, date);
  const [trip] = await world.db
    .insert(trips)
    .values({
      planId,
      depotId: world.depot.plg,
      vehicleId: world.vehicleId,
      driverId,
      tripNo: 1,
      brand: 'FRESH',
      districtId: world.depot.plgDistrict,
      tempClass: 'AMBIENT',
      status: 'IN_PROGRESS',
      releasedAt: new Date(`${date}T02:30:00+05:30`),
      plannedDepartAt: new Date(`${date}T03:30:00+05:30`),
    })
    .returning({ id: trips.id });

  const orderNo = `WF-${world.sfx}${nextSeq()}`;
  const [order] = await world.db
    .insert(orders)
    .values({
      orderNo,
      outletId: world.kadawatha,
      depotId: world.depot.plg,
      brand: 'FRESH',
      districtId: world.depot.plgDistrict,
      tempClass: 'AMBIENT',
      requestedDate: date,
      deliveryDate: date,
      status: input.orderStatus ?? 'DELIVERED',
      version: input.version ?? 8,
      units,
      weightKg: units * 10,
      volumeM3: units * 0.02,
      source: 'seed',
      submittedAt: new Date(`${date}T01:00:00+05:30`),
    })
    .returning({ id: orders.id });

  const lineRows = await world.db
    .insert(orderLines)
    .values(
      lines.map((line, i) => ({
        orderId: order.id,
        itemId: itemIds[i],
        qty: line.expected,
        unitWeightKg: 10,
        unitVolumeM3: 0.02,
        unitValueLkr: null,
      })),
    )
    .returning({ id: orderLines.id });
  const lineIds = lineRows.map((l) => l.id);

  const etaAt =
    input.etaAt === undefined
      ? new Date(`${date}T04:10:00+05:30`)
      : input.etaAt === null
        ? null
        : new Date(input.etaAt);
  const completedAt =
    input.completedAt === undefined
      ? finished
        ? new Date(`${date}T04:22:00+05:30`)
        : null
      : input.completedAt === null
        ? null
        : new Date(input.completedAt);
  const [stop] = await world.db
    .insert(stops)
    .values({
      tripId: trip.id,
      orderId: order.id,
      outletId: world.kadawatha,
      depotId: world.depot.plg,
      brand: 'FRESH',
      districtId: world.depot.plgDistrict,
      seq: 1,
      status: stopStatus,
      plannedArrivalAt: new Date(`${date}T04:00:00+05:30`),
      plannedServiceMin: 12,
      windowOpenMin: 330,
      windowCloseMin: 450,
      etaAt,
      completedAt,
      outcome:
        stopStatus === 'DELIVERED' || stopStatus === 'PARTIAL'
          ? stopStatus
          : null,
      unitsDelivered: finished
        ? lines.reduce((sum, l) => sum + (l.delivered ?? 0), 0)
        : null,
      receiverName: input.receiverName ?? null,
    })
    .returning({ id: stops.id });
  await world.db
    .update(orders)
    .set({ activeStopId: stop.id })
    .where(eq(orders.id, order.id));

  const delivered = lines.flatMap((line, i) =>
    line.delivered === null
      ? []
      : [
          {
            stopId: stop.id,
            orderLineId: lineIds[i],
            qtyExpected: line.expected,
            qtyDelivered: line.delivered,
            condition: 'ok',
          },
        ],
  );
  if (delivered.length) await world.db.insert(deliveryLines).values(delivered);

  if (input.proofFiles)
    await world.db.insert(attachments).values(
      (['SIGNATURE', 'POD_PHOTO'] as const).map((kind) => ({
        kind,
        ownerType: 'stop',
        ownerId: stop.id,
        storageKey: `test/${world.sfx}/${stop.id}/${kind}`,
        contentType: 'image/png',
        bytes: 1000,
        uploadedAt: new Date(`${date}T04:22:00+05:30`),
        createdById: driverId,
      })),
    );

  return {
    orderId: order.id,
    orderNo,
    stopId: stop.id,
    tripId: trip.id,
    lineIds,
  };
}

/**
 * What execution does when the driver's DELIVERED record finally syncs: the stop is
 * DELIVERED with its lines and the order moves from IN_TRANSIT to DELIVERED.
 */
export async function syncDelivery(
  world: World,
  seeded: SeededDelivery,
  at: string,
  delivered: number[],
): Promise<void> {
  await world.db
    .update(stops)
    .set({
      status: 'DELIVERED',
      outcome: 'DELIVERED',
      completedAt: new Date(at),
      unitsDelivered: delivered.reduce((a, b) => a + b, 0),
    })
    .where(eq(stops.id, seeded.stopId));
  await world.db.insert(deliveryLines).values(
    seeded.lineIds.map((orderLineId, i) => ({
      stopId: seeded.stopId,
      orderLineId,
      qtyExpected: 12,
      qtyDelivered: delivered[i],
      condition: 'ok',
    })),
  );
  const [current] = await world.db
    .select({ version: orders.version })
    .from(orders)
    .where(eq(orders.id, seeded.orderId));
  await world.db
    .update(orders)
    .set({ status: 'DELIVERED', version: current.version + 1 })
    .where(eq(orders.id, seeded.orderId));
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

/** An issue row seeded directly, for criteria about scope, threads and resolution. */
export async function seedIssue(
  world: World,
  input: {
    outletId?: string;
    orderId?: string | null;
    stopId?: string | null;
    type?: (typeof issues.$inferInsert)['type'];
    status?: (typeof issues.$inferInsert)['status'];
    raisedBy?: Role;
    resolvedAt?: string;
    resolution?: (typeof issues.$inferInsert)['resolution'];
  } = {},
): Promise<string> {
  const raisedBy = input.raisedBy ?? 'store';
  const [row] = await world.db
    .insert(issues)
    .values({
      outletId: input.outletId ?? world.kadawatha,
      orderId: input.orderId ?? null,
      stopId: input.stopId ?? null,
      type: input.type ?? 'DAMAGED',
      qtyAffected: 3,
      description: '3 trays damaged',
      status: input.status ?? 'OPEN',
      resolution: input.resolution ?? null,
      resolvedAt: input.resolvedAt ? new Date(input.resolvedAt) : null,
      resolvedById: input.resolvedAt ? world.as.dispatcher.id : null,
      raisedById: world.as[raisedBy].id,
      raisedByRole: raisedBy === 'driver' ? 'driver' : 'store_manager',
    })
    .returning({ id: issues.id });
  return row.id;
}

/**
 * Everything this world seeded goes, and the audit mark moves to now, so each test starts
 * from nothing without touching the audit chain other suites share. Outbox rows are a
 * queue, so they are deleted.
 */
export async function resetDeliveries(world: World): Promise<void> {
  const outletIds = [world.kadawatha, world.otherOutlet, world.kandyOutlet];
  const issueIds = (
    await world.db
      .select({ id: issues.id })
      .from(issues)
      .where(inArray(issues.outletId, outletIds))
  ).map((i) => i.id);
  const orderIds = (
    await world.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.depotId, world.depot.plg))
  ).map((o) => o.id);
  const stopIds = orderIds.length
    ? (
        await world.db
          .select({ id: stops.id })
          .from(stops)
          .where(inArray(stops.orderId, orderIds))
      ).map((s) => s.id)
    : [];

  if (issueIds.length) {
    await world.db
      .delete(comments)
      .where(
        and(
          eq(comments.entityType, 'issue'),
          inArray(comments.entityId, issueIds),
        ),
      );
  }
  const owners = [...issueIds, ...stopIds];
  if (owners.length)
    await world.db
      .delete(attachments)
      .where(inArray(attachments.ownerId, owners));
  await world.db.delete(issues).where(inArray(issues.outletId, outletIds));
  if (orderIds.length) {
    const receiptIds = (
      await world.db
        .select({ id: receipts.id })
        .from(receipts)
        .where(inArray(receipts.orderId, orderIds))
    ).map((r) => r.id);
    if (receiptIds.length)
      await world.db
        .delete(receiptLines)
        .where(inArray(receiptLines.receiptId, receiptIds));
    await world.db.delete(receipts).where(inArray(receipts.orderId, orderIds));
  }
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
  await world.db.delete(trips).where(eq(trips.depotId, world.depot.plg));
  await world.db.delete(plans).where(eq(plans.depotId, world.depot.plg));
  await world.db.delete(orders).where(eq(orders.depotId, world.depot.plg));
  await world.db
    .delete(outboxEvents)
    .where(
      or(
        eq(outboxEvents.depotId, world.depot.plg),
        eq(outboxEvents.depotId, world.depot.kdy),
      ),
    );
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
 * The audit rows an action wrote in this test, oldest first. Suites share one database and
 * run in parallel, so rows are taken from past the mark `resetDeliveries` set and from this
 * world's own people.
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
        // A row the system wrote (the reconcile) has no person behind it: ask by entity.
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

/** The outbox events of a type in this world's depots, for the "exactly one" checks. */
export async function outboxRows(
  world: World,
  type: string,
): Promise<(typeof outboxEvents.$inferSelect)[]> {
  return world.db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.type, type),
        or(
          eq(outboxEvents.depotId, world.depot.plg),
          eq(outboxEvents.depotId, world.depot.kdy),
        ),
      ),
    )
    .orderBy(asc(outboxEvents.occurredAt));
}

export async function orderRow(
  world: World,
  id: string,
): Promise<typeof orders.$inferSelect> {
  const [row] = await world.db.select().from(orders).where(eq(orders.id, id));
  return row;
}

export async function receiptRows(
  world: World,
  orderId: string,
): Promise<(typeof receipts.$inferSelect)[]> {
  return world.db.select().from(receipts).where(eq(receipts.orderId, orderId));
}

export async function receiptLineRows(
  world: World,
  receiptId: string,
): Promise<(typeof receiptLines.$inferSelect)[]> {
  return world.db
    .select()
    .from(receiptLines)
    .where(eq(receiptLines.receiptId, receiptId));
}

export async function issueRows(
  world: World,
  orderId: string,
): Promise<(typeof issues.$inferSelect)[]> {
  return world.db.select().from(issues).where(eq(issues.orderId, orderId));
}

export async function commentRows(
  world: World,
  issueId: string,
): Promise<(typeof comments.$inferSelect)[]> {
  return world.db
    .select()
    .from(comments)
    .where(
      and(eq(comments.entityType, 'issue'), eq(comments.entityId, issueId)),
    );
}

/** Freezes the demo clock, the way every criterion states a time. */
export function at(world: World, instant: string): void {
  freezeClock(world.app, instant);
}
