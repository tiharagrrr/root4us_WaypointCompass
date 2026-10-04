import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq, gt } from 'drizzle-orm';
import request from 'supertest';
import { browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  outletFixture,
  suffix,
  vehicleFixture,
} from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import { auditEvents, outboxEvents, vehicles } from '../../../db/schema';

const AT_0440 = '2026-10-02T04:40:00+05:30';

interface VehicleBody {
  id: string;
  code: string;
  registrationNo: string;
  depotId: string;
  type: string;
  temp: string;
  weightCapKg: number;
  volumeCapM3: number;
  kmPerL: number;
  weeklyFuelQuotaL: number;
  status: string;
  statusReason: string | null;
  version: number;
  _links: Record<string, { href: string; method?: string }>;
}

const body = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
const etag = (version: number) => `W/"${version}"`;

/**
 * A5's list, read and edit (AC-FLT-06, AC-FLT-07). The status endpoint's own
 * criteria live with the repair run it feeds (planning-repair.e2e.spec.ts);
 * here it is the link beside it that matters, and who may send the PATCH.
 */
describeWithDb('fleet: vehicles on A5', () => {
  jest.setTimeout(120_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let truck: string;
  let kandyTruck: string;
  const cookies: Record<string, string> = {};
  let auditFrom = 0;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    const outletId = await outletFixture(db, `OUTV${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    truck = await vehicleFixture(db, `DRY-${sfx}`, depot.plg);
    kandyTruck = await vehicleFixture(db, `KDY-${sfx}`, depot.kdy);

    for (const [key, input] of [
      ['admin', { role: 'admin' as const }],
      ['dispatcher', { role: 'dispatcher' as const, depotId: depot.plg }],
      ['kandy', { role: 'dispatcher' as const, depotId: depot.kdy }],
      ['loader', { role: 'loader' as const, depotId: depot.plg }],
      ['driver', { role: 'driver' as const, depotId: depot.plg }],
      ['store', { role: 'store_manager' as const, outletId }],
    ] as const) {
      cookies[key] = (await signedInAs(app, db, input)).cookie;
    }
  });

  afterAll(async () => {
    freezeClock(app, AT_0440).reset();
    await close();
    await app.close();
  });

  beforeEach(async () => {
    freezeClock(app, AT_0440);
    await db
      .update(vehicles)
      .set({
        status: 'ACTIVE',
        statusReason: null,
        statusChangedAt: null,
        weeklyFuelQuotaL: 400,
        kmPerL: 6,
      })
      .where(eq(vehicles.id, truck));
    auditFrom = await lastSeq();
  });

  const lastSeq = async () => {
    const [row] = await db
      .select({ seq: auditEvents.seq })
      .from(auditEvents)
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    return row?.seq ?? 0;
  };

  const auditSince = (action: string, entityId: string) =>
    db
      .select()
      .from(auditEvents)
      .where(
        and(
          gt(auditEvents.seq, auditFrom),
          eq(auditEvents.action, action),
          eq(auditEvents.entityId, entityId),
        ),
      );

  const call = (
    role: string,
    method: 'get' | 'patch' | 'put',
    path: string,
    version?: number,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(browser())
      .set('Cookie', cookies[role]);
    return version === undefined ? req : req.set('If-Match', etag(version));
  };

  const versionOf = async (id: string) => {
    const [row] = await db
      .select({ version: vehicles.version })
      .from(vehicles)
      .where(eq(vehicles.id, id));
    return row.version;
  };

  it('A5 lists the depot fleet with its filters', async () => {
    const res = await call(
      'admin',
      'get',
      `/vehicles?filter[depotId]=${depot.plg}&limit=10`,
    );

    expect(res.status).toBe(200);
    const page = res.body as {
      data: VehicleBody[];
      meta: { page: { limit: number; offset: number; total: number } };
    };
    expect(page.data.map((v) => v.id)).toContain(truck);
    expect(page.data.every((v) => v.depotId === depot.plg)).toBe(true);
    expect(page.meta.page).toMatchObject({ limit: 10, offset: 0 });

    // A dispatcher sees their own depot only, whatever they ask for.
    const kandy = await call(
      'dispatcher',
      'get',
      `/vehicles?filter[depotId]=${depot.kdy}`,
    );
    expect(kandy.status).toBe(200);
    expect((kandy.body as { data: VehicleBody[] }).data).toHaveLength(0);

    const unlisted = await call('admin', 'get', '/vehicles?filter[kmPerL]=6');
    expect(unlisted.status).toBe(400);
    expect(
      JSON.stringify(expectProblem(unlisted, 'VALIDATION_FAILED').errors),
    ).toContain('kmPerL');
  });

  it('AC-FLT-06 who may change a status', async () => {
    const version = await versionOf(truck);

    const admin = await call(
      'admin',
      'put',
      `/vehicles/${truck}/status`,
      version,
    ).send({ status: 'WORKSHOP', reason: 'Service' });
    expect(admin.status).toBe(200);

    const dispatcher = await call(
      'dispatcher',
      'put',
      `/vehicles/${truck}/status`,
      await versionOf(truck),
    ).send({ status: 'ACTIVE', reason: 'Back' });
    expect(dispatcher.status).toBe(200);

    for (const role of ['loader', 'driver', 'store'] as const) {
      const res = await call(
        role,
        'put',
        `/vehicles/${truck}/status`,
        await versionOf(truck),
      ).send({ status: 'BREAKDOWN', reason: 'x' });
      expect([role, res.status]).toEqual([role, 403]);
      expectProblem(res, 'FORBIDDEN');
    }
    const [unchanged] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, truck));
    expect(unchanged.status).toBe('ACTIVE');

    const outOfDepot = await call(
      'kandy',
      'put',
      `/vehicles/${truck}/status`,
      await versionOf(truck),
    ).send({ status: 'BREAKDOWN', reason: 'x' });
    expect(outOfDepot.status).toBe(404);
    expectProblem(outOfDepot, 'NOT_FOUND');

    // The links say the same thing the endpoint does.
    for (const [role, status, links] of [
      ['admin', 200, ['status', 'edit', 'fuel']],
      ['dispatcher', 200, ['status', 'fuel']],
      ['loader', 200, []],
      ['driver', 200, []],
      ['store', 200, []],
    ] as const) {
      const res = await call(role, 'get', `/vehicles/${truck}`);
      expect([role, res.status]).toEqual([role, status]);
      const carried = Object.keys(body<VehicleBody>(res)._links);
      expect([role, carried.sort()]).toEqual([role, [...links, 'self'].sort()]);
    }
    expect((await call('kandy', 'get', `/vehicles/${truck}`)).status).toBe(404);
    expect(
      (await call('dispatcher', 'get', `/vehicles/${kandyTruck}`)).status,
    ).toBe(404);
  });

  it('AC-FLT-07 only admins edit vehicle details', async () => {
    const version = await versionOf(truck);

    const res = await call(
      'admin',
      'patch',
      `/vehicles/${truck}`,
      version,
    ).send({
      weeklyFuelQuotaL: 450,
      kmPerL: 7,
    });

    expect(res.status).toBe(200);
    expect(body<VehicleBody>(res)).toMatchObject({
      weeklyFuelQuotaL: 450,
      kmPerL: 7,
      version: version + 1,
    });
    const audits = await auditSince('fleet.vehicle.updated', truck);
    expect(audits).toHaveLength(1);
    expect(audits[0].before).toMatchObject({ weeklyFuelQuotaL: 400 });
    expect(audits[0].after).toMatchObject({ weeklyFuelQuotaL: 450 });
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.type, 'vehicle.updated'),
            eq(outboxEvents.aggregateId, truck),
          ),
        ),
    ).not.toHaveLength(0);

    const asDispatcher = await call(
      'dispatcher',
      'patch',
      `/vehicles/${truck}`,
      await versionOf(truck),
    ).send({ weeklyFuelQuotaL: 500 });
    expect(asDispatcher.status).toBe(403);
    expectProblem(asDispatcher, 'FORBIDDEN');

    const stale = await call(
      'admin',
      'patch',
      `/vehicles/${truck}`,
      version,
    ).send({ weeklyFuelQuotaL: 500 });
    expect(stale.status).toBe(412);
    expectProblem(stale, 'VERSION_MISMATCH');

    const noIfMatch = await call('admin', 'patch', `/vehicles/${truck}`).send({
      weeklyFuelQuotaL: 500,
    });
    expect(noIfMatch.status).toBe(428);
    expectProblem(noIfMatch, 'PRECONDITION_REQUIRED');

    const [after] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, truck));
    expect(after.weeklyFuelQuotaL).toBe(450);

    // The status is the status endpoint's business, not a detail edit.
    const viaPatch = await call(
      'admin',
      'patch',
      `/vehicles/${truck}`,
      await versionOf(truck),
    ).send({ status: 'BREAKDOWN' });
    expect(viaPatch.status).toBe(400);
    expect(
      JSON.stringify(expectProblem(viaPatch, 'VALIDATION_FAILED').errors),
    ).toContain('status');
  });
});
