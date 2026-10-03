import '../../../../test/demo-mode';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, like } from 'drizzle-orm';
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
import { freezeClock } from '../../../../test/kernel';
import type { Database } from '../../client';
import { deferralReasonRows } from '../../deferral-reasons.seed';
import {
  auditEvents,
  deferralReasons,
  deferrals,
  orderLines,
  orders,
  plans,
  settings,
  stops,
  trips,
  vehicles,
} from '../../schema';
import { seedCatalog } from '../catalog';
import { importHistory, parseHistory } from '../history';
import { importS1 } from '../import-s1';
import { importKandyDay } from '../kandy-day';
import { rebuildDemoDay } from '../rebuild';
import { S1_SETTING } from '../s1';

/** The demo window these tests use, far from every other suite's dates. */
const DAYS = ['2027-03-09', '2027-03-10', '2027-03-11'];
const [YESTERDAY, D, TOMORROW] = DAYS;

interface World {
  sfx: string;
  depotId: string;
  outlets: string[];
  workshop: string;
  available: string;
  refs: string[];
  dir: string;
}

/**
 * A small invented S1 (never the booklet's rows, specs/data/datasets.md): three outlets, three
 * orders of which one outlet was skipped yesterday, and two vehicles of which one is in the
 * workshop. The CSVs are written to a temporary SEED_DATA_DIR with the booklet's header names.
 */
async function world(db: Database): Promise<World> {
  const sfx = suffix();
  const anchor = await depotFixture(db, sfx);
  const place = { depotId: anchor.plg, districtId: anchor.plgDistrict };
  const outlets = [
    await outletFixture(db, `S${sfx}A`, place),
    await outletFixture(db, `S${sfx}B`, place),
    await outletFixture(db, `S${sfx}C`, place),
  ];
  const workshop = await vehicleFixture(db, `V${sfx}W`, anchor.plg);
  const available = await vehicleFixture(db, `V${sfx}A`, anchor.plg);
  const refs = [`S1-${sfx}-01`, `S1-${sfx}-02`, `S1-${sfx}-03`];
  const dir = mkdtempSync(join(tmpdir(), 'compass-s1-'));
  const header =
    'scenario,order_ref,outlet_id,brand,district,depot,temp_requirement,order_units,order_weight_kg,order_volume_m3,deferred_yesterday,days_since_last_served';
  writeFileSync(
    join(dir, 'task2b_peak_day_scenarios.csv'),
    [
      header,
      `S1,${refs[0]},${outlets[0]},Fresh,Test,Peliyagoda,chilled,10,1200,4.5,0,2`,
      `S1,${refs[1]},${outlets[1]},Fresh,Test,Peliyagoda,ambient,8,640,3.25,1,4`,
      `S1,${refs[2]},${outlets[2]},Fresh,Test,Peliyagoda,ambient,4,300,1.5,0,1`,
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'task2b_peak_day_fleet.csv'),
    [
      'scenario,vehicle_id,status',
      `S1,${workshop},in_workshop`,
      `S1,${available},available`,
    ].join('\n'),
  );
  await db
    .insert(deferralReasons)
    .values(deferralReasonRows())
    .onConflictDoNothing();
  return { sfx, depotId: anchor.plg, outlets, workshop, available, refs, dir };
}

const seeded = (db: Database, w: World) =>
  db.select().from(orders).where(inArray(orders.externalRef, w.refs));

async function seed(db: Database, w: World) {
  await seedCatalog(db);
  await importS1(db, w.dir, D, { draftOutletId: w.outlets[0] });
  await rebuildDemoDay(db, DAYS, { depots: [w.depotId] });
}

describeWithDb('demo day (ROO-22)', () => {
  jest.setTimeout(120_000);
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
  });
  afterAll(async () => {
    freezeClock(app, new Date().toISOString()).reset();
    await close();
    await app.close();
  });

  it('ROO-22 the S1 day loads as confirmed orders, and running it twice changes nothing', async () => {
    const w = await world(db);
    await seed(db, w);

    const rows = await seeded(db, w);
    const byRef = new Map(rows.map((o) => [o.externalRef, o]));
    expect(byRef.get(w.refs[0])).toMatchObject({
      status: 'CONFIRMED',
      requestedDate: D,
      deliveryDate: D,
      source: 'seed',
      deferredCount: 0,
    });
    // Skipped yesterday: it waits as DEFERRED from D−1, so the engine sees a repeat skip.
    expect(byRef.get(w.refs[1])).toMatchObject({
      status: 'DEFERRED',
      requestedDate: YESTERDAY,
      deliveryDate: D,
      deferredCount: 1,
    });

    for (const order of rows) {
      const lines = await db
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, order.id));
      expect(lines.reduce((n, l) => n + l.qty * l.unitWeightKg, 0)).toBeCloseTo(
        order.weightKg,
        6,
      );
      expect(lines.reduce((n, l) => n + l.qty * l.unitVolumeM3, 0)).toBeCloseTo(
        order.volumeM3,
        6,
      );
    }

    const [yesterday] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.depotId, w.depotId), eq(plans.date, YESTERDAY)));
    expect(yesterday?.status).toBe('CLOSED');
    const skipped = await db
      .select()
      .from(deferrals)
      .where(eq(deferrals.planId, yesterday.id));
    expect(skipped).toEqual([
      expect.objectContaining({
        orderId: byRef.get(w.refs[1])!.id,
        status: 'CONFIRMED',
        fromDate: YESTERDAY,
        toDate: D,
        storeResponse: 'AWAITING',
      }),
    ]);

    const fleet = await db
      .select()
      .from(vehicles)
      .where(inArray(vehicles.id, [w.workshop, w.available]));
    expect(Object.fromEntries(fleet.map((v) => [v.id, v.status]))).toEqual({
      [w.workshop]: 'WORKSHOP',
      [w.available]: 'ACTIVE',
    });

    const draft = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.outletId, w.outlets[0]),
          eq(orders.status, 'DRAFT'),
          eq(orders.source, 'seed'),
        ),
      );
    expect(draft).toEqual([
      expect.objectContaining({
        tempClass: 'AMBIENT',
        requestedDate: TOMORROW,
      }),
    ]);
    expect(
      await db
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, draft[0].id)),
    ).not.toHaveLength(0);

    // Twice: the same rows, not more of them.
    await seed(db, w);
    expect(await seeded(db, w)).toHaveLength(3);
    expect(
      await db.select().from(plans).where(eq(plans.depotId, w.depotId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(deferrals)
        .where(
          inArray(
            deferrals.orderId,
            rows.map((o) => o.id),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(orders)
        .where(
          and(eq(orders.outletId, w.outlets[0]), eq(orders.status, 'DRAFT')),
        ),
    ).toHaveLength(1);
  });

  it('AC-IDN-59 demo reset rebuilds the demo day', async () => {
    const w = await world(db);
    await seed(db, w);
    const [first, , third] = await Promise.all(
      w.refs.map(
        async (ref) =>
          (
            await db.select().from(orders).where(eq(orders.externalRef, ref))
          )[0],
      ),
    );

    // The walkthrough: a plan for D with the first order on a trip, the third order cancelled,
    // the workshop vehicle back in service, and a store's own order for a later day.
    const [plan] = await db
      .insert(plans)
      .values({ depotId: w.depotId, date: D, status: 'PUBLISHED', revision: 1 })
      .returning();
    const [trip] = await db
      .insert(trips)
      .values({
        planId: plan.id,
        depotId: w.depotId,
        vehicleId: w.available,
        tripNo: 1,
        brand: 'FRESH',
        districtId: first.districtId,
        tempClass: 'CHILLED',
        status: 'PLANNED',
      })
      .returning();
    const [stop] = await db
      .insert(stops)
      .values({
        tripId: trip.id,
        orderId: first.id,
        outletId: first.outletId,
        depotId: w.depotId,
        brand: 'FRESH',
        districtId: first.districtId,
        seq: 1,
        plannedServiceMin: 15,
        windowOpenMin: 300,
        windowCloseMin: 450,
      })
      .returning();
    await db
      .update(orders)
      .set({ status: 'PLANNED', activeStopId: stop.id })
      .where(eq(orders.id, first.id));
    await db
      .update(orders)
      .set({ status: 'CANCELLED', cancelledAt: new Date() })
      .where(eq(orders.id, third.id));
    await db
      .update(vehicles)
      .set({ status: 'ACTIVE' })
      .where(eq(vehicles.id, w.workshop));
    const [later] = await db
      .insert(orders)
      .values({
        orderNo: `T${w.sfx}-L`,
        outletId: first.outletId,
        depotId: w.depotId,
        brand: 'FRESH',
        districtId: first.districtId,
        tempClass: 'AMBIENT',
        requestedDate: '2027-03-20',
        deliveryDate: '2027-03-20',
        status: 'SUBMITTED',
      })
      .returning();

    const resets = () =>
      db.$count(
        auditEvents,
        and(
          eq(auditEvents.action, 'core.demo.reset'),
          eq(auditEvents.entityId, D),
        ),
      );
    const before = await resets();
    const rusiru = await signedInAs(app, db, { role: 'admin' });
    freezeClock(app, `${YESTERDAY}T10:00:00+05:30`);
    const res = await request(app.getHttpServer())
      .post('/api/v1/demo/reset')
      .set(browser())
      .set('Cookie', rusiru.cookie)
      .send({});
    expect(res.status).toBe(200);
    expect((res.body as { data: { days: string[] } }).data.days).toEqual(DAYS);

    expect(
      await db
        .select()
        .from(plans)
        .where(and(eq(plans.depotId, w.depotId), eq(plans.date, D))),
    ).toEqual([]);
    const back = new Map((await seeded(db, w)).map((o) => [o.externalRef, o]));
    expect(back.get(w.refs[0])).toMatchObject({
      status: 'CONFIRMED',
      activeStopId: null,
    });
    expect(back.get(w.refs[2])).toMatchObject({
      status: 'CONFIRMED',
      cancelledAt: null,
    });
    expect(
      (await db.select().from(vehicles).where(eq(vehicles.id, w.workshop)))[0]
        ?.status,
    ).toBe('WORKSHOP');
    // Outside D−1 to D+1: untouched.
    expect(
      (await db.select().from(orders).where(eq(orders.id, later.id)))[0],
    ).toMatchObject({ status: 'SUBMITTED', updatedAt: later.updatedAt });
    expect(await resets()).toBe(before + 1);
    expect(
      await db
        .select()
        .from(orders)
        .where(like(orders.orderNo, `T${w.sfx}-%`)),
    ).toHaveLength(1);
  });

  it("ROO-22 history loads the operating days before D−1 as closed plans, and the last day becomes Kandy's demo day", async () => {
    const sfx = suffix();
    const anchor = await depotFixture(db, sfx);
    const plg = { depotId: anchor.plg, districtId: anchor.plgDistrict };
    const a = await outletFixture(db, `H${sfx}A`, plg);
    const b = await outletFixture(db, `H${sfx}B`, plg);
    const k = await outletFixture(db, `H${sfx}K`, {
      depotId: anchor.kdy,
      districtId: anchor.kdyDistrict,
    });
    const vp = await vehicleFixture(db, `V${sfx}P`, anchor.plg);
    const vk = await vehicleFixture(db, `V${sfx}K`, anchor.kdy);
    await db
      .insert(deferralReasons)
      .values(deferralReasonRows())
      .onConflictDoNothing();
    await seedCatalog(db);

    // Invented rows over three source days (Mon 3 to Wed 5 March 2025); the last is Kandy's.
    const row = (
      id: string,
      outlet: string,
      vehicle: string,
      cells: Partial<Record<string, string>>,
    ) => ({
      delivery_id: `H${sfx}-${id}`,
      order_date: '2025-03-03',
      dispatch_date: '2025-03-03',
      dispatch_status: 'attempted',
      outlet_id: outlet,
      temp_requirement: 'ambient',
      order_units: '10',
      order_weight_kg: '200',
      order_volume_m3: '1',
      route_id: `R${sfx}-${id}`,
      seq_in_route: '0',
      vehicle_id: vehicle,
      planned_arrival_time: '05:45',
      window_open_time: '05:30',
      window_close_time: '07:30',
      ...cells,
    });
    const rows = parseHistory(
      [
        row('1', a, vp, {}),
        // Waited from Monday's run to Tuesday's, then ran second on Tuesday's route.
        row('2', b, vp, {
          dispatch_date: '2025-03-04',
          dispatch_status: 'deferred',
          route_id: `R${sfx}-T`,
          seq_in_route: '1',
          planned_arrival_time: '06:10',
        }),
        row('3', a, vp, {
          order_date: '2025-03-04',
          dispatch_date: '2025-03-04',
          route_id: `R${sfx}-T`,
        }),
        row('4', b, vp, {
          dispatch_status: 'not_run',
          dispatch_date: '',
          route_id: '',
          seq_in_route: '',
          vehicle_id: '',
          planned_arrival_time: '',
        }),
        row('5', k, vk, {
          order_date: '2025-03-05',
          dispatch_date: '2025-03-05',
        }),
      ].map((r) => r as Record<string, string>),
    );

    const past = await importHistory(db, rows, D);
    // D−1 is Tue 9 March 2027; the two operating days before it are Sat 6 and Mon 8.
    expect(past).toMatchObject({
      days: ['2027-03-06', '2027-03-08'],
      plans: 2,
      orders: 3,
      trips: 2,
      deferrals: 1,
      skipped: 0,
    });

    const byRef = new Map(
      (
        await db
          .select()
          .from(orders)
          .where(like(orders.externalRef, `H${sfx}-%`))
      ).map((o) => [o.externalRef, o]),
    );
    expect(byRef.get(`H${sfx}-1`)).toMatchObject({
      status: 'DELIVERED',
      requestedDate: '2027-03-06',
      deliveryDate: '2027-03-06',
    });
    expect(byRef.get(`H${sfx}-2`)).toMatchObject({
      status: 'DELIVERED',
      requestedDate: '2027-03-06',
      deliveryDate: '2027-03-08',
      deferredCount: 1,
    });
    expect(byRef.has(`H${sfx}-4`)).toBe(false);

    const closed = await db
      .select()
      .from(plans)
      .where(eq(plans.depotId, anchor.plg));
    expect(closed.map((p) => [p.date, p.status]).sort()).toEqual([
      ['2027-03-06', 'CLOSED'],
      ['2027-03-08', 'CLOSED'],
    ]);
    const tuesday = closed.find((p) => p.date === '2027-03-08')!;
    const [route] = await db
      .select()
      .from(trips)
      .where(eq(trips.planId, tuesday.id));
    expect(route).toMatchObject({
      vehicleId: vp,
      tripNo: 1,
      status: 'COMPLETED',
      loadWeightKg: 400,
    });
    const served = await db
      .select()
      .from(stops)
      .where(eq(stops.tripId, route.id));
    expect(
      served
        .sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0))
        .map((st) => [st.orderId, st.status]),
    ).toEqual([
      [byRef.get(`H${sfx}-3`)!.id, 'DELIVERED'],
      [byRef.get(`H${sfx}-2`)!.id, 'DELIVERED'],
    ]);
    expect(byRef.get(`H${sfx}-2`)!.activeStopId).toBe(
      served.find((st) => st.orderId === byRef.get(`H${sfx}-2`)!.id)!.id,
    );
    expect(
      await db
        .select()
        .from(deferrals)
        .where(eq(deferrals.orderId, byRef.get(`H${sfx}-2`)!.id)),
    ).toEqual([
      expect.objectContaining({
        planId: closed.find((p) => p.date === '2027-03-06')!.id,
        status: 'CONFIRMED',
        fromDate: '2027-03-06',
        toDate: '2027-03-08',
        storeResponse: 'ACKNOWLEDGED',
      }),
    ]);

    // Kandy: Wednesday's Kandy order, confirmed on D with the whole Kandy fleet in service.
    await db
      .update(vehicles)
      .set({ status: 'WORKSHOP' })
      .where(eq(vehicles.id, vk));
    expect(await importKandyDay(db, rows, D, anchor.kdy)).toMatchObject({
      sourceDay: '2025-03-05',
      orders: 1,
      created: 1,
    });
    await rebuildDemoDay(db, DAYS, { depots: [anchor.kdy] });
    const [kandy] = await db
      .select()
      .from(orders)
      .where(eq(orders.externalRef, `H${sfx}-5`));
    expect(kandy).toMatchObject({
      status: 'CONFIRMED',
      depotId: anchor.kdy,
      deliveryDate: D,
    });
    expect(
      await db
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, kandy.id)),
    ).not.toHaveLength(0);
    expect(
      (await db.select().from(vehicles).where(eq(vehicles.id, vk)))[0]?.status,
    ).toBe('ACTIVE');
    const [snapshot] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, S1_SETTING), eq(settings.scope, anchor.kdy)));
    expect(snapshot?.value).toMatchObject({ v: 2, orders: [`H${sfx}-5`] });

    // Twice: nothing new.
    expect(await importHistory(db, rows, D)).toBeNull();
    expect(await importKandyDay(db, rows, D, anchor.kdy)).toMatchObject({
      created: 0,
    });
    expect(await db.$count(orders, like(orders.externalRef, `H${sfx}-%`))).toBe(
      4,
    );
  });
});
