import type { NestExpressApplication } from '@nestjs/platform-express';
import type { UserRole } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import request, { type Response } from 'supertest';
import { uuidv7 } from 'uuidv7';
import { browser, signedInAs } from '../../../../test/auth';
import { createTestApp, ownerDatabase } from '../../../../test/create-test-app';
import {
  calendarFixture,
  depotFixture,
  outletFixture,
  suffix,
} from '../../../../test/fixtures';
import { freezeClock } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import { deferralReasonRows } from '../../../db/deferral-reasons.seed';
import {
  auditEvents,
  deferralReasons,
  depots,
  districts,
  orders,
  outboxEvents,
  serviceAllowances,
  settings,
  users,
  vehicles,
} from '../../../db/schema';

/** The demo day: PLG plans 2026-10-02, and publishing opens at 16:00 the day before. */
export const DAY = '2026-10-02';
export const OPEN = '2026-10-01T16:05:00+05:30';

type Role =
  'dispatcher' | 'admin' | 'store_manager' | 'loader' | 'driver' | 'kandy';

export interface World {
  app: NestExpressApplication;
  db: Database;
  close: () => Promise<void>;
  cookies: Record<Role, string>;
  kandyDepot: string;
  /** The store manager's outlet, in the Peliyagoda-like anchor depot. */
  store: { depotId: string; districtId: string; outletId: string };
}

/** One depot's day, built fresh for a test so no two tests share a plan. */
export interface DepotDay {
  depotId: string;
  districtId: string;
  outlets: string[];
  vehicles: { ref07: string; ref03: string; dry31: string; workshop: string };
  codes: { ref07: string; ref03: string; dry31: string };
  driverId: string;
  /** Order ids by name, in the order they were made. */
  orders: Record<string, string>;
}

export interface OrderSpec {
  outlet?: number;
  tempClass?: 'CHILLED' | 'AMBIENT';
  volumeM3: number;
  weightKg?: number;
  status?: 'CONFIRMED' | 'DEFERRED';
  deferredCount?: number;
}

/**
 * Hand-built rows (never the datasets, specs/data/datasets.md): a Peliyagoda-
 * like depot with one district (37 min out, 9 between stops), six Fresh
 * outlets open 05:30 to 07:30, reefers REF-07 and REF-03 (12 m³), a dry truck
 * DRY-31, a reefer in the workshop, a driver, and the orders a test asks for.
 */
export async function buildWorld(): Promise<World> {
  const app = await createTestApp();
  const { db, close } = ownerDatabase();
  await calendarFixture(db);
  // Allowances are global; a seeded database already has them.
  const brands = ['FRESH', 'STYLE', 'TECH'] as const;
  const docks = ['REAR_DOCK', 'STREET', 'MALL_BAY'] as const;
  await db
    .insert(serviceAllowances)
    .values(
      brands.flatMap((brand) =>
        docks.map((dockType) => ({ brand, dockType, minutes: 15 })),
      ),
    )
    .onConflictDoNothing()
    .catch(() => undefined);

  await db
    .insert(deferralReasons)
    .values(deferralReasonRows())
    .onConflictDoNothing();

  const sfx = suffix();
  const anchor = await depotFixture(db, sfx);
  const storeOutlet = await outletFixture(db, `SM${sfx}`, {
    depotId: anchor.plg,
    districtId: anchor.plgDistrict,
  });
  const roles: Record<
    Role,
    { role: UserRole; depotId?: string | null; outletId?: string }
  > = {
    dispatcher: { role: 'dispatcher', depotId: null },
    admin: { role: 'admin' },
    store_manager: {
      role: 'store_manager',
      outletId: storeOutlet,
    },
    loader: { role: 'loader', depotId: anchor.plg },
    driver: { role: 'driver', depotId: anchor.plg },
    kandy: { role: 'dispatcher', depotId: anchor.kdy },
  };
  const cookies = {} as Record<Role, string>;
  for (const [name, input] of Object.entries(roles) as [
    Role,
    (typeof roles)[Role],
  ][])
    cookies[name] = (await signedInAs(app, db, input)).cookie;
  freezeClock(app, OPEN);
  return {
    app,
    db,
    close,
    cookies,
    kandyDepot: anchor.kdy,
    store: {
      depotId: anchor.plg,
      districtId: anchor.plgDistrict,
      outletId: storeOutlet,
    },
  };
}

export async function tearDown(w: World): Promise<void> {
  freezeClock(w.app, OPEN).reset();
  await w.close();
  await w.app.close();
}

export async function depotDay(
  w: World,
  specs: Record<string, OrderSpec> = {},
  opts: { outletWindowClose?: number[] } = {},
): Promise<DepotDay> {
  const sfx = suffix();
  const depotId = `P${sfx}`;
  const districtId = `gampaha-${sfx}`;
  await w.db.insert(depots).values({ id: depotId, name: `Peliyagoda ${sfx}` });
  await w.db.insert(districts).values({
    id: districtId,
    name: `Gampaha ${sfx}`,
    depotId,
    roadClass: 'URBAN',
    freeFlowKmh: 30,
    depotToDistrictKm: 20,
    depotToDistrictMin: 37,
    interStopKm: 4,
    interStopMin: 9,
  });
  // The criteria assume the 16:00 cutoff; pin it for this depot.
  await w.db
    .insert(settings)
    .values({ key: 'ordering.cutoffMin', scope: depotId, value: 960 })
    .onConflictDoNothing();

  const outlets: string[] = [];
  for (let i = 0; i < 6; i += 1)
    outlets.push(
      await outletFixture(
        w.db,
        `O${i}${sfx}`,
        { depotId, districtId },
        {
          name: `Fresh Outlet ${i} ${sfx}`,
          windowCloseMin: opts.outletWindowClose?.[i] ?? 450,
        },
      ),
    );

  const vehicle = (
    code: string,
    temp: 'REEFER' | 'AMBIENT',
    extra: Partial<typeof vehicles.$inferInsert> = {},
  ) => ({
    id: `V-${code}-${sfx}`,
    code: `${code}-${sfx}`,
    registrationNo: `REG-${code}-${sfx}`,
    type: 'TRUCK' as const,
    temp,
    weightCapKg: 3000,
    volumeCapM3: 12,
    fuelType: 'diesel',
    kmPerL: 5,
    weeklyFuelQuotaL: 400,
    depotId,
    ...extra,
  });
  const fleet = [
    vehicle('REF-07', 'REEFER'),
    vehicle('REF-03', 'REEFER'),
    vehicle('DRY-31', 'AMBIENT', { volumeCapM3: 20 }),
    vehicle('REF-11', 'REEFER', {
      status: 'WORKSHOP',
      statusReason: 'Compressor service',
    }),
  ];
  await w.db.insert(vehicles).values(fleet);

  const driverId = uuidv7();
  await w.db.insert(users).values({
    id: driverId,
    name: `Driver ${sfx}`,
    email: `driver-${sfx}@test.waypoint.local`,
    emailVerified: true,
    role: 'driver',
    depotId,
  });

  const orderIds: Record<string, string> = {};
  let n = 0;
  for (const [name, spec] of Object.entries(specs)) {
    n += 1;
    const outletId = outlets[spec.outlet ?? 0];
    const [row] = await w.db
      .insert(orders)
      .values({
        orderNo: `T${sfx}-${String(n).padStart(2, '0')}`,
        outletId,
        depotId,
        brand: 'FRESH',
        districtId,
        tempClass: spec.tempClass ?? 'CHILLED',
        requestedDate: DAY,
        deliveryDate: DAY,
        status: spec.status ?? 'CONFIRMED',
        deferredCount: spec.deferredCount ?? 0,
        units: 10,
        weightKg: spec.weightKg ?? 100,
        volumeM3: spec.volumeM3,
        source: 'backorder',
      })
      .returning({ id: orders.id });
    orderIds[name] = row.id;
  }

  return {
    depotId,
    districtId,
    outlets,
    vehicles: {
      ref07: fleet[0].id,
      ref03: fleet[1].id,
      dry31: fleet[2].id,
      workshop: fleet[3].id,
    },
    codes: { ref07: fleet[0].code, ref03: fleet[1].code, dry31: fleet[2].code },
    driverId,
    orders: orderIds,
  };
}

/** A request as one of the world's people, with If-Match and an Idempotency-Key when given. */
export function call(
  w: World,
  role: Role,
  method: 'get' | 'post',
  path: string,
  opts: { body?: unknown; version?: number; key?: string } = {},
) {
  let req = request(w.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set(browser())
    .set('Cookie', w.cookies[role]);
  if (opts.version !== undefined)
    req = req.set('If-Match', `W/"${opts.version}"`);
  if (opts.key) req = req.set('Idempotency-Key', opts.key);
  return method === 'post' ? req.send(opts.body ?? {}) : req;
}

export const data = <T>(res: Response): T => (res.body as { data: T }).data;

export async function auditCount(
  w: World,
  action: string,
  entityId: string,
): Promise<number> {
  const rows = await w.db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.action, action), eq(auditEvents.entityId, entityId)),
    );
  return rows.length;
}

export async function outboxOf(w: World, type: string, aggregateId: string) {
  return w.db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.type, type),
        eq(outboxEvents.aggregateId, aggregateId),
      ),
    );
}
