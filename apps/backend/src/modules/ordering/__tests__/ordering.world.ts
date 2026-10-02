import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TempClass } from '@waypoint/shared';
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
import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gt,
  inArray,
  or,
} from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import { JobContextRunner } from '../../../core/context/job-context';
import type { Database } from '../../../db/client';
import {
  auditEvents,
  depots,
  items,
  orderDayMarks,
  orderLines,
  orderTemplates,
  orders,
  outboxEvents,
  outlets,
  receivingRosterEntries,
  settings,
} from '../../../db/schema';
import { CutoffProcessor } from '../jobs/cutoff.processor';
import { CutoffCloseService } from '../services/cutoff-close.service';

/**
 * The world every ordering suite runs in, built once per suite from
 * hand-made rows (the competition datasets stay out of tests, see
 * specs/data/datasets.md):
 *
 * - depots PLG and KDY, each with one district, and the demo calendar
 *   (2026-09-30 to 2026-10-03 operate, 2026-10-04 does not);
 * - Fresh Kadawatha and a second Fresh outlet at PLG, a Style outlet whose
 *   weekly delivery day is Friday, a Tech outlet, and a Fresh outlet at KDY;
 * - a catalog with Fresh dry and chilled items, a Style item, a Tech item
 *   that carries value, and a Fresh dry item that has left the catalog;
 * - a signed-in user for every role the criteria name.
 *
 * Item sizes are whole numbers (10 kg, 0.02 m³, 1 000 LKR a pack), so a
 * criterion can state a total rather than compute one.
 */
export interface World {
  app: NestExpressApplication;
  db: Database;
  close: () => Promise<void>;
  sfx: string;
  depot: Awaited<ReturnType<typeof depotFixture>>;
  outlets: {
    kadawatha: string;
    otherFresh: string;
    style: string;
    tech: string;
    kandy: string;
  };
  items: {
    dryA: string;
    dryB: string;
    dryC: string;
    chilled: string;
    style: string;
    tech: string;
    retired: string;
  };
  as: Record<Role, { id: string; cookie: string }>;
  /**
   * The audit sequence this test started from. The trail is a hash chain
   * shared with every other suite, so rows are never deleted between tests;
   * `auditRows` looks only past this mark instead (set by `resetOrders`).
   */
  auditFrom: number;
}

export type Role =
  | 'store'
  | 'otherStore'
  | 'styleStore'
  | 'techStore'
  | 'kandyStore'
  | 'dispatcher'
  | 'kandyDispatcher'
  | 'loader'
  | 'driver'
  | 'admin';

export async function buildWorld(): Promise<World> {
  const sfx = suffix();
  const app = await createTestApp();
  const { db, close } = ownerDatabase();
  const depot = await depotFixture(db, sfx);
  await calendarFixture(db);
  // The criteria assume the 16:00 cutoff with no depot override. The global
  // `ordering.cutoffMin` row is shared with every other suite in this
  // database, so each depot of this world pins its own, which wins over it.
  await db
    .insert(settings)
    .values(
      [depot.plg, depot.kdy].map((scope) => ({
        key: 'ordering.cutoffMin',
        scope,
        value: 960,
      })),
    )
    .onConflictDoNothing();

  const plg = { depotId: depot.plg, districtId: depot.plgDistrict };
  const kdy = { depotId: depot.kdy, districtId: depot.kdyDistrict };
  const outlets = {
    kadawatha: await outletFixture(db, `OUTK${sfx}`, plg, {
      name: `Fresh Kadawatha ${sfx}`,
      windowOpenMin: 420,
      windowCloseMin: 540,
    }),
    otherFresh: await outletFixture(db, `OUTF${sfx}`, plg, {
      name: `Fresh Ja-Ela ${sfx}`,
    }),
    // Friday is weekday 4 with Monday as 0, and 2026-10-02 is a Friday.
    style: await outletFixture(db, `OUTS${sfx}`, plg, {
      brand: 'STYLE',
      name: `Style Negombo ${sfx}`,
      styleDeliveryDow: 4,
    }),
    tech: await outletFixture(db, `OUTT${sfx}`, plg, {
      brand: 'TECH',
      name: `Tech Wattala ${sfx}`,
    }),
    kandy: await outletFixture(db, `OUTY${sfx}`, kdy, {
      name: `Fresh Peradeniya ${sfx}`,
    }),
  };

  const items = {
    dryA: await itemFixture(db, { sku: `FR-A${sfx}`, name: `Rice ${sfx}` }),
    dryB: await itemFixture(db, {
      sku: `FR-B${sfx}`,
      name: `Flour ${sfx}`,
      unitWeightKg: 20,
      unitVolumeM3: 0.03,
    }),
    dryC: await itemFixture(db, {
      sku: `FR-C${sfx}`,
      name: `Sugar ${sfx}`,
      unitWeightKg: 5,
      unitVolumeM3: 0.01,
    }),
    chilled: await itemFixture(db, {
      sku: `FR-D${sfx}`,
      name: `Yoghurt ${sfx}`,
      tempClass: 'CHILLED',
    }),
    style: await itemFixture(db, {
      sku: `ST-A${sfx}`,
      name: `Shirt ${sfx}`,
      brand: 'STYLE',
      unitWeightKg: 1,
      unitVolumeM3: 0.01,
    }),
    tech: await itemFixture(db, {
      sku: `TE-A${sfx}`,
      name: `Router ${sfx}`,
      brand: 'TECH',
      unitWeightKg: 2,
      unitVolumeM3: 0.01,
      unitValueLkr: 1000,
    }),
    retired: await itemFixture(db, {
      sku: `FR-X${sfx}`,
      name: `Discontinued tea ${sfx}`,
      active: false,
    }),
  };

  const signIn = async (
    role: Parameters<typeof signedInAs>[2]['role'],
    scope: { depotId?: string; outletId?: string } = {},
  ) => {
    const user = await signedInAs(app, db, { role, ...scope });
    return { id: user.id, cookie: user.cookie };
  };

  const as: World['as'] = {
    store: await signIn('store_manager', { outletId: outlets.kadawatha }),
    otherStore: await signIn('store_manager', { outletId: outlets.otherFresh }),
    styleStore: await signIn('store_manager', { outletId: outlets.style }),
    techStore: await signIn('store_manager', { outletId: outlets.tech }),
    kandyStore: await signIn('store_manager', { outletId: outlets.kandy }),
    dispatcher: await signIn('dispatcher', { depotId: depot.plg }),
    kandyDispatcher: await signIn('dispatcher', { depotId: depot.kdy }),
    loader: await signIn('loader', { depotId: depot.plg }),
    driver: await signIn('driver', { depotId: depot.plg }),
    admin: await signIn('admin'),
  };

  return { app, db, close, sfx, depot, outlets, items, as, auditFrom: 0 };
}

export async function tearDownWorld(world: World): Promise<void> {
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

/** A versioned write: the same call with If-Match, as every screen sends it. */
export function write(
  world: World,
  role: Role,
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
  version: number,
) {
  return call(world, role, method, path).set('If-Match', `W/"${version}"`);
}

/** The envelope's data, typed the way a criterion reads it. */
export const data = <T>(res: Response): T => (res.body as { data: T }).data;

export const notices = (res: Response): { code: string; message: string }[] =>
  (res.body as { meta?: { notices?: { code: string; message: string }[] } })
    .meta?.notices ?? [];

/** An order as the API returns it, in the fields the criteria check. */
export interface OrderBody {
  id: string;
  orderNo: string;
  status: string;
  tempClass: TempClass;
  brand: string;
  requestedDate: string;
  deliveryDate: string;
  afterCutoff: boolean;
  urgent: boolean;
  totals: {
    lines: number;
    units: number;
    weightKg: number;
    volumeM3: number;
    valueLkr: number | null;
  };
  outlet: { id: string; name: string };
  deliveryWindow: {
    openMin: number;
    open: string;
    closeMin: number;
    close: string;
  };
  note: string | null;
  templateId: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  editableUntil: string;
  version: number;
  _links: Record<
    string,
    { href: string; method?: string; requires?: string[] }
  >;
}

/** The lines response of GET /orders/{id}/lines. */
export interface LinesBody {
  orderId: string;
  version: number;
  lines: {
    id: string;
    itemId: string;
    sku: string;
    name: string;
    qty: number;
    weightKg: number;
    volumeM3: number;
    _links: Record<string, { href: string }>;
  }[];
  _links: Record<string, { href: string }>;
}

/**
 * An order written straight into the database, for the criteria that start
 * from a state the API cannot reach (a CONFIRMED order, yesterday's history).
 * Totals follow the lines, exactly as the service would compute them.
 */
export async function seedOrder(
  world: World,
  input: {
    outletId: string;
    status?: (typeof orders.$inferInsert)['status'];
    tempClass?: TempClass;
    requestedDate?: string;
    deliveryDate?: string;
    lines?: { itemId: string; qty: number }[];
    urgent?: boolean;
    afterCutoff?: boolean;
    orderNo?: string;
    submittedAt?: Date | null;
    source?: string;
  },
): Promise<{ id: string; orderNo: string; version: number }> {
  const [outlet] = await world.db
    .select()
    .from(outlets)
    .where(eq(outlets.id, input.outletId));
  if (!outlet) throw new Error(`No outlet fixture ${input.outletId}`);
  const requestedDate = input.requestedDate ?? '2026-10-02';
  const lines = input.lines ?? [{ itemId: world.items.dryA, qty: 2 }];
  const catalog = await world.db.select().from(items);
  const snapshots = lines.map((line) => {
    const item = catalog.find((i) => i.id === line.itemId);
    if (!item) throw new Error(`No item fixture ${line.itemId}`);
    return {
      itemId: item.id,
      qty: line.qty,
      unitWeightKg: item.unitWeightKg,
      unitVolumeM3: item.unitVolumeM3,
      unitValueLkr: item.unitValueLkr,
    };
  });
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const units = snapshots.reduce((sum, l) => sum + l.qty, 0);
  const weightKg = round2(
    snapshots.reduce((sum, l) => sum + l.qty * l.unitWeightKg, 0),
  );
  const volumeM3 = round2(
    snapshots.reduce((sum, l) => sum + l.qty * l.unitVolumeM3, 0),
  );
  const valued = snapshots.filter((l) => l.unitValueLkr != null);
  const valueLkr = valued.length
    ? valued.reduce((sum, l) => sum + l.qty * (l.unitValueLkr ?? 0), 0)
    : null;

  const prefix =
    outlet.brand === 'FRESH' ? 'WF' : outlet.brand === 'STYLE' ? 'WS' : 'WT';
  const [row] = await world.db
    .insert(orders)
    .values({
      orderNo: input.orderNo ?? `${prefix}-${world.sfx}${nextSeq()}`,
      outletId: outlet.id,
      depotId: outlet.depotId,
      brand: outlet.brand,
      districtId: outlet.districtId,
      tempClass: input.tempClass ?? 'AMBIENT',
      requestedDate,
      deliveryDate: input.deliveryDate ?? requestedDate,
      status: input.status ?? 'SUBMITTED',
      afterCutoff: input.afterCutoff ?? false,
      urgent: input.urgent ?? false,
      units,
      weightKg,
      volumeM3,
      valueLkr,
      source: input.source ?? 'seed',
      submittedAt:
        input.submittedAt === undefined
          ? new Date('2026-10-01T09:00:00+05:30')
          : input.submittedAt,
      placedById: world.as.store.id,
    })
    .returning({
      id: orders.id,
      orderNo: orders.orderNo,
      version: orders.version,
    });
  if (snapshots.length)
    await world.db
      .insert(orderLines)
      .values(snapshots.map((line) => ({ ...line, orderId: row.id })));
  return row;
}

/**
 * Order numbers for seeded rows. The world's suffix goes in, because suites
 * run in parallel against one database and `orders.orderNo` is unique.
 */
let counter = 1000;
const nextSeq = () => String((counter += 1)).padStart(4, '0');

/** Puts a depot's cutoff minute back, for the criteria that move it. */
export async function setDepotCutoffMin(
  world: World,
  depotId: string,
  cutoffMin: number | null,
): Promise<void> {
  await world.db
    .update(depots)
    .set({ cutoffMin })
    .where(eq(depots.id, depotId));
}

/**
 * Every order, preset, roster and day mark of this world goes, and the audit
 * mark moves to now, so each test starts from nothing without touching the
 * audit chain other suites share. Outbox rows are a queue, so they are
 * deleted outright.
 */
export async function resetOrders(world: World): Promise<void> {
  const outletIds = Object.values(world.outlets);
  const depotIds = [world.depot.plg, world.depot.kdy];
  await world.db.delete(orders).where(inArray(orders.outletId, outletIds));
  await world.db
    .delete(orderTemplates)
    .where(inArray(orderTemplates.outletId, outletIds));
  await world.db
    .delete(receivingRosterEntries)
    .where(inArray(receivingRosterEntries.outletId, outletIds));
  await world.db
    .delete(orderDayMarks)
    .where(inArray(orderDayMarks.scopeId, [...outletIds, ...depotIds]));
  await world.db
    .delete(outboxEvents)
    .where(
      or(
        inArray(outboxEvents.depotId, depotIds),
        arrayOverlaps(outboxEvents.outletIds, outletIds),
      ),
    );
  world.auditFrom = await lastAuditSeq(world);
}

/** The highest audit sequence written so far, whoever wrote it. */
async function lastAuditSeq(world: World): Promise<number> {
  const [row] = await world.db
    .select({ seq: auditEvents.seq })
    .from(auditEvents)
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  return row?.seq ?? 0;
}

/**
 * Runs one of ordering's tick handlers the way the worker's ticker does: in a
 * job context stamped as the system, with the clock's `now`. A test can then
 * "let the clock pass 16:00" without waiting a minute.
 *
 * The cutoff tick is narrowed to this world's own depots. `CutoffService.due`
 * still decides which days are due — that is the behaviour AC-ORD-24 is
 * about — but the close itself stops at this world's depots, because suites
 * share one database and run in parallel: a real sweep closes every due day
 * it finds, so another suite's tick would otherwise claim this world's day
 * and report its own count. The reminder sweep is global by nature, so its
 * criteria filter the events they read instead.
 */
export async function tick(
  world: World,
  which: 'cutoff' | 'reminder',
  at?: string,
): Promise<void> {
  const clock = world.app.get(ClockService);
  if (at) clock.freeze(at);
  const now = clock.now();
  const closures = world.app.get(CutoffCloseService);
  const processor = world.app.get(CutoffProcessor);
  const depotIds = new Set([world.depot.plg, world.depot.kdy]);
  await world.app
    .get(JobContextRunner)
    .run({ id: `tick:ordering.${which}:${now.toISOString()}` }, async () => {
      if (which === 'reminder') return processor.remindMissingOrders(now);
      for (const day of await closures.due(now))
        if (depotIds.has(day.depotId))
          await closures.close(day.depotId, day.deliveryDate, 'ticker');
    });
}

/**
 * The audit rows an action wrote in this test, oldest first, for the
 * "exactly one audit row" checks. Only rows past `world.auditFrom` count, so
 * an earlier test in the same suite cannot inflate the answer.
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
        entityId ? eq(auditEvents.entityId, entityId) : undefined,
      ),
    )
    .orderBy(asc(auditEvents.seq));
}

/** The outbox events of a type, for the "exactly once" checks. */
export async function outboxRows(
  world: World,
  type: string,
  aggregateId?: string,
): Promise<(typeof outboxEvents.$inferSelect)[]> {
  return world.db
    .select()
    .from(outboxEvents)
    .where(
      aggregateId
        ? and(
            eq(outboxEvents.type, type),
            eq(outboxEvents.aggregateId, aggregateId),
          )
        : eq(outboxEvents.type, type),
    )
    .orderBy(asc(outboxEvents.occurredAt));
}

/** The stored order row, for "the order is unchanged" checks. */
export async function orderRow(
  world: World,
  id: string,
): Promise<typeof orders.$inferSelect> {
  const [row] = await world.db.select().from(orders).where(eq(orders.id, id));
  return row;
}

/** The stored lines of an order, in item order. */
export async function lineRows(
  world: World,
  orderId: string,
): Promise<(typeof orderLines.$inferSelect)[]> {
  return world.db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId));
}

/** How many orders the world's outlets hold, whatever other suites left behind. */
export async function ownOrderCount(world: World): Promise<number> {
  const rows = await world.db
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.outletId, Object.values(world.outlets)));
  return rows.length;
}

/**
 * Puts a seeded order at a given version, for the criteria that start from
 * "a SUBMITTED order at version 3". Reaching it through line writes would
 * test the line endpoints rather than the one under the criterion.
 */
export async function setOrderVersion(
  world: World,
  id: string,
  version: number,
): Promise<void> {
  await world.db.update(orders).set({ version }).where(eq(orders.id, id));
}
