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
  calendarFixture,
  depotFixture,
  itemFixture,
  outletFixture,
  suffix,
} from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import { auditEvents, outboxEvents, outlets } from '../../../db/schema';
import { OUTLET_UPDATED } from '../services/outlets.service';

const AT_0900 = '2026-10-01T09:00:00+05:30';

interface OutletBody {
  id: string;
  windowOpenMin: number;
  windowOpen: string;
  windowCloseMin: number;
  windowClose: string;
  accessNotes: string | null;
  accessNotesUpdatedAt: string | null;
  accessNotesUpdatedById: string | null;
  brand: string;
  districtId: string;
  depotId: string;
  dockType: string;
  parkingConstraint: string;
  receivingContactName: string | null;
  receivingContactPhone: string | null;
  _links: Record<string, { href: string; method?: string }>;
}

const body = <T>(res: { body: unknown }) => (res.body as { data: T }).data;

/**
 * Master data as A3, A4 and M1a read and edit it: the outlet window rules,
 * the audit trail behind an edit, the time labels every screen shows, and
 * the reference tables every role reads (AC-MD-01 to 04, 08, 10 and 11).
 */
describeWithDb('master data', () => {
  jest.setTimeout(90_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let outletId: string;
  let itemIds: { dry: string; chilled: string; style: string };
  const cookies: Record<string, string> = {};
  const users: Record<string, string> = {};
  let auditFrom = 0;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    await calendarFixture(db);
    outletId = await outletFixture(
      db,
      `OUTM${sfx}`,
      { depotId: depot.plg, districtId: depot.plgDistrict },
      {
        name: `Fresh Kadawatha ${sfx}`,
        windowOpenMin: 360,
        windowCloseMin: 600,
      },
    );
    itemIds = {
      dry: await itemFixture(db, {
        sku: `MD-A${sfx}`,
        name: `Dry rice ${sfx}`,
      }),
      chilled: await itemFixture(db, {
        sku: `MD-B${sfx}`,
        name: `Chilled yoghurt ${sfx}`,
        tempClass: 'CHILLED',
      }),
      style: await itemFixture(db, {
        sku: `MD-C${sfx}`,
        name: `Style shirt ${sfx}`,
        brand: 'STYLE',
      }),
    };

    for (const [key, input] of [
      ['admin', { role: 'admin' as const }],
      ['dispatcher', { role: 'dispatcher' as const, depotId: depot.plg }],
      ['store', { role: 'store_manager' as const, outletId }],
      ['loader', { role: 'loader' as const, depotId: depot.plg }],
      ['driver', { role: 'driver' as const, depotId: depot.plg }],
    ] as const) {
      const user = await signedInAs(app, db, input);
      cookies[key] = user.cookie;
      users[key] = user.id;
    }
  });

  afterAll(async () => {
    freezeClock(app, AT_0900).reset();
    await close();
    await app.close();
  });

  beforeEach(async () => {
    freezeClock(app, AT_0900);
    await db
      .update(outlets)
      .set({
        windowOpenMin: 360,
        windowCloseMin: 600,
        mallWindowOpenMin: null,
        mallWindowCloseMin: null,
        accessNotes: null,
        accessNotesUpdatedAt: null,
        accessNotesUpdatedById: null,
      })
      .where(eq(outlets.id, outletId));
    // The audit trail is a hash chain shared with every other suite, so
    // rows are never deleted between tests; each test looks past this mark.
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

  const call = (role: string, method: 'get' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(browser())
      .set('Cookie', cookies[role]);

  it('AC-MD-01 close before open is refused', async () => {
    const earlyClose = await call(
      'admin',
      'patch',
      `/outlets/${outletId}`,
    ).send({ windowCloseMin: 300 });

    expect(earlyClose.status).toBe(400);
    expect(expectProblem(earlyClose, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'windowCloseMin' }),
    ]);
    const unchanged = body<OutletBody>(
      await call('admin', 'get', `/outlets/${outletId}`),
    );
    expect(unchanged).toMatchObject({
      windowOpenMin: 360,
      windowCloseMin: 600,
    });
    expect(
      await auditSince('master_data.outlet.updated', outletId),
    ).toHaveLength(0);

    const halfMall = await call('admin', 'patch', `/outlets/${outletId}`).send({
      mallWindowOpenMin: 420,
    });

    expect(halfMall.status).toBe(400);
    expect(expectProblem(halfMall, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({
        field: 'mallWindowCloseMin',
        code: 'required',
      }),
    ]);
    expect(
      body<OutletBody>(await call('admin', 'get', `/outlets/${outletId}`)),
    ).toMatchObject({ windowOpenMin: 360, windowCloseMin: 600 });
  });

  it('AC-MD-02 outlet edits are audited and announced', async () => {
    const res = await call('admin', 'patch', `/outlets/${outletId}`).send({
      accessNotes: 'Use the lane behind the bakery.',
    });

    expect(res.status).toBe(200);
    expect(body<OutletBody>(res)).toMatchObject({
      accessNotes: 'Use the lane behind the bakery.',
      accessNotesUpdatedAt: '2026-10-01T09:00:00+05:30',
      accessNotesUpdatedById: users.admin,
    });

    const audits = await auditSince('master_data.outlet.updated', outletId);
    expect(audits).toHaveLength(1);
    expect(audits[0].before).toMatchObject({ accessNotes: null });
    expect(audits[0].after).toMatchObject({
      accessNotes: 'Use the lane behind the bakery.',
    });

    const events = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, OUTLET_UPDATED),
          eq(outboxEvents.aggregateId, outletId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ v: 1, id: outletId });
  });

  it('AC-MD-03 outlet times carry minutes and labels', async () => {
    const outlet = body<OutletBody>(
      await call('dispatcher', 'get', `/outlets/${outletId}`),
    );

    expect(outlet).toMatchObject({
      windowOpenMin: 360,
      windowOpen: '06:00',
      windowCloseMin: 600,
      windowClose: '10:00',
      brand: 'FRESH',
      districtId: depot.plgDistrict,
      depotId: depot.plg,
      dockType: 'REAR_DOCK',
      parkingConstraint: 'NORMAL',
    });
    expect(outlet).toHaveProperty('receivingContactName');
    expect(outlet).toHaveProperty('receivingContactPhone');
    expect(outlet).toHaveProperty('accessNotes');
  });

  it('AC-MD-04 the outlet list filters and pages', async () => {
    const res = await call(
      'admin',
      'get',
      `/outlets?filter[brand]=FRESH&filter[depotId]=${depot.plg}&limit=10`,
    );

    expect(res.status).toBe(200);
    const page = res.body as {
      data: OutletBody[];
      meta: { page: { limit: number; offset: number; total: number } };
    };
    expect(page.data.length).toBeLessThanOrEqual(10);
    expect(
      page.data.every((o) => o.brand === 'FRESH' && o.depotId === depot.plg),
    ).toBe(true);
    expect(page.meta.page).toMatchObject({ limit: 10, offset: 0 });
    expect(page.meta.page.total).toBeGreaterThanOrEqual(1);

    const unlisted = await call('admin', 'get', '/outlets?filter[address]=x');
    expect(unlisted.status).toBe(400);
    expect(
      JSON.stringify(expectProblem(unlisted, 'VALIDATION_FAILED').errors),
    ).toContain('address');
  });

  it('AC-MD-08 the item picker filters the catalog (M1a)', async () => {
    const chilled = await call(
      'store',
      'get',
      `/items?filter[brand]=FRESH&filter[tempClass]=CHILLED&q=${sfx}`,
    );

    expect(chilled.status).toBe(200);
    const page = chilled.body as {
      data: {
        id: string;
        sku: string;
        name: string;
        category: string;
        packLabel: string;
        unitWeightKg: number;
        unitVolumeM3: number;
        active: boolean;
        brand: string;
        tempClass: string;
      }[];
    };
    expect(page.data.map((i) => i.id)).toEqual([itemIds.chilled]);
    expect(page.data[0]).toMatchObject({
      brand: 'FRESH',
      tempClass: 'CHILLED',
      category: 'Staples',
      packLabel: 'Case of 6',
      unitWeightKg: 10,
      unitVolumeM3: 0.02,
      active: true,
    });

    const byName = await call('store', 'get', `/items?q=${'DRY RICE'}`);
    expect(
      (byName.body as { data: { id: string }[] }).data.map((i) => i.id),
    ).toContain(itemIds.dry);
    expect(
      (byName.body as { data: { id: string }[] }).data.map((i) => i.id),
    ).not.toContain(itemIds.style);
  });

  it('AC-MD-10 operating days and the fallback', async () => {
    const res = await call(
      'store',
      'get',
      '/calendar?from=2026-09-30&to=2026-10-04',
    );

    expect(res.status).toBe(200);
    const days = (
      res.body as {
        data: { date: string; isOperating: boolean; isHoliday: boolean }[];
      }
    ).data;
    expect(days).toHaveLength(5);
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(days.find((d) => d.date === '2026-10-04')).toMatchObject({
      isOperating: false,
    });
    expect(days.every((d) => typeof d.isHoliday === 'boolean')).toBe(true);
  });

  it('AC-MD-11 reference data for every role', async () => {
    const paths = [
      '/districts',
      '/service-allowances',
      '/traffic-speeds',
      '/road-conditions',
      '/depots',
      '/calendar?from=2026-09-30&to=2026-10-04',
    ];
    for (const role of ['admin', 'dispatcher', 'store', 'loader', 'driver'])
      for (const path of paths) {
        const res = await call(role, 'get', path);
        expect([role, path, res.status]).toEqual([role, path, 200]);
      }

    for (const path of paths) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set(browser());
      expect([path, res.status]).toEqual([path, 401]);
      expectProblem(res, 'UNAUTHENTICATED');
    }
  });

  it('AC-MD-12 a missing permission is 403', async () => {
    const cases: [string, 'get' | 'patch', string][] = [
      ['dispatcher', 'patch', `/outlets/${outletId}`],
      ['dispatcher', 'patch', `/depots/${depot.plg}`],
      ['store', 'patch', `/outlets/${outletId}`],
      ['loader', 'get', '/items'],
      ['driver', 'get', '/items'],
    ];
    for (const [role, method, path] of cases) {
      const res = await call(role, method, path).send({ dockCount: 9 });
      expect([role, path, res.status]).toEqual([role, path, 403]);
      expectProblem(res, 'FORBIDDEN');
    }
  });

  it('AC-MD-06 depot settings are audited (A4)', async () => {
    const res = await call('admin', 'patch', `/depots/${depot.plg}`).send({
      chilledDocks: 3,
      cutoffMin: 900,
    });

    expect(res.status).toBe(200);
    expect(
      body<{
        dockCount: number;
        chilledDocks: number;
        cutoffMin: number;
        effectiveCutoffMin: number;
        effectiveCutoff: string;
      }>(res),
    ).toMatchObject({
      dockCount: 6,
      chilledDocks: 3,
      cutoffMin: 900,
      effectiveCutoffMin: 900,
      effectiveCutoff: '15:00',
    });

    const audits = await auditSince('master_data.depot.updated', depot.plg);
    expect(audits).toHaveLength(1);
    expect(audits[0].before).toMatchObject({
      chilledDocks: 2,
      cutoffMin: null,
    });
    expect(audits[0].after).toMatchObject({ chilledDocks: 3, cutoffMin: 900 });

    // Put the depot back, so a later suite reading this database finds the
    // 16:00 cutoff it expects.
    await call('admin', 'patch', `/depots/${depot.plg}`).send({
      chilledDocks: 2,
      cutoffMin: null,
    });
  });
});
