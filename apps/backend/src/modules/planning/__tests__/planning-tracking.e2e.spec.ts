import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { browser, signedInAs } from '../../../../test/auth';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { stops, trips } from '../../../db/schema';
import type { PlanDto } from '../dto/plan.dto';
import type { OrderEtaDto } from '../dto/tracking.dto';
import {
  buildWorld,
  call,
  data,
  DAY,
  depotDay,
  OPEN,
  tearDown,
  type World,
} from './planning.world';

interface Board {
  date: string;
  planStatus: string | null;
  totals: {
    trips: number;
    onRoad: number;
    released: number;
    stopsPlanned: number;
    stopsDelivered: number;
    lateRisk: number;
    deferred: number;
  };
  trips: {
    tripId: string;
    vehicleCode: string;
    status: string;
    standing: string;
    delivered: number;
    stopsTotal: number;
    nextEtaAt: string | null;
    stops: {
      stopId: string;
      outletName: string;
      standing: string;
      etaAt: string | null;
      spareMin: number | null;
      arrivedAt: string | null;
    }[];
  }[];
}

describeWithDb('planning: the live day (ROO-46)', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  /** REF-07 trip 1 with three stops, published, and its rows. */
  async function publishedRun() {
    const day = await depotDay(w, {
      a: { volumeM3: 1 },
      b: { volumeM3: 1, outlet: 1 },
      c: { volumeM3: 1, outlet: 2 },
    });
    const key = `${day.codes.ref07}#1`;
    let p = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
    );
    p = data<PlanDto>(
      await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
        version: p.version,
        key: crypto.randomUUID(),
        body: {
          ops: [
            {
              op: 'ADD_TRIP',
              vehicleId: day.vehicles.ref07,
              tripNo: 1,
              brand: 'FRESH',
              districtId: day.districtId,
            },
            ...['a', 'b', 'c'].map((o) => ({
              op: 'ASSIGN_ORDER',
              orderId: day.orders[o],
              tripKey: key,
            })),
            { op: 'SET_DRIVER', tripKey: key, driverId: day.driverId },
          ],
        },
      }),
    );
    p = data<PlanDto>(
      await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
        version: p.version,
        key: crypto.randomUUID(),
      }),
    );
    const [trip] = await w.db
      .select()
      .from(trips)
      .where(
        and(eq(trips.planId, p.id), eq(trips.vehicleId, day.vehicles.ref07)),
      );
    const tripStops = (
      await w.db.select().from(stops).where(eq(stops.tripId, trip.id))
    ).sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    return { day, trip, tripStops };
  }

  it('AC-PLN-39 the live day shows each trip’s progress, projected arrivals and late risk', async () => {
    const { day, trip, tripStops } = await publishedRun();

    // Before it leaves: the planned times, nobody on the road.
    const board = async () =>
      data<Board>(
        await call(
          w,
          'dispatcher',
          'get',
          `/depots/${day.depotId}/tracking?date=${DAY}`,
        ),
      );
    let b = await board();
    expect(b).toMatchObject({
      date: DAY,
      planStatus: 'PUBLISHED',
      totals: { trips: 1, onRoad: 0, stopsPlanned: 3, stopsDelivered: 0 },
    });

    // On the road at 05:40, the first stop delivered.
    const at = new Date(`${DAY}T05:35:00+05:30`);
    await w.db
      .update(trips)
      .set({ status: 'IN_PROGRESS', startedAt: at })
      .where(eq(trips.id, trip.id));
    await w.db
      .update(stops)
      .set({
        status: 'DELIVERED',
        outcome: 'DELIVERED',
        arrivedAt: at,
        completedAt: at,
      })
      .where(eq(stops.id, tripStops[0].id));
    freezeClock(w.app, `${DAY}T05:40:00+05:30`);
    b = await board();
    expect(b.totals).toMatchObject({
      onRoad: 1,
      stopsDelivered: 1,
      lateRisk: 0,
    });
    const run = b.trips.find((t) => t.tripId === trip.id)!;
    expect(run).toMatchObject({
      status: 'IN_PROGRESS',
      standing: 'ON_TIME',
      delivered: 1,
      stopsTotal: 3,
    });
    expect(run.stops.map((s) => s.standing)).toEqual([
      'DELIVERED',
      'NEXT',
      expect.stringMatching(/PLANNED|AT_RISK/),
    ]);
    expect(new Date(run.stops[0].arrivedAt!).getTime()).toBe(at.getTime());
    expect(run.stops[1].etaAt).toBeTruthy();
    expect(run.stops[1].spareMin).toBeGreaterThan(0);
    expect(run.nextEtaAt).toBe(run.stops[1].etaAt);

    // Running late: at 07:20 the stops left would miss their 07:30 windows.
    freezeClock(w.app, `${DAY}T07:20:00+05:30`);
    b = await board();
    const late = b.trips.find((t) => t.tripId === trip.id)!;
    expect(late.standing).toBe('LATE_RISK');
    expect(late.stops.some((s) => s.standing === 'LATE')).toBe(true);
    expect(b.totals.lateRisk).toBeGreaterThan(0);

    // A Kandy dispatcher cannot read Peliyagoda's day.
    const kandy = await call(
      w,
      'kandy',
      'get',
      `/depots/${day.depotId}/tracking?date=${DAY}`,
    );
    expect(kandy.status).toBe(404);
  });
  it('AC-EXE-22 a store sees her ETA, never the map', async () => {
    const { day, trip, tripStops } = await publishedRun();
    const stop = tripStops[1];
    const store = await signedInAs(w.app, w.db, {
      role: 'store_manager',
      outletId: stop.outletId,
    });
    const other = await signedInAs(w.app, w.db, {
      role: 'store_manager',
      outletId: tripStops[2].outletId,
    });
    const get = (cookie: string, path: string) =>
      request(w.app.getHttpServer())
        .get(`/api/v1${path}`)
        .set(browser())
        .set('Cookie', cookie);

    // Before the trip leaves: the planned arrival.
    let res = await get(store.cookie, `/orders/${stop.orderId}/eta`);
    expect(res.status).toBe(200);
    let eta = data<OrderEtaDto>(res);
    expect(eta).toMatchObject({
      orderId: stop.orderId,
      stopId: stop.id,
      tripStatus: 'PLANNED',
      stopStatus: 'PENDING',
    });
    expect(eta.etaAt).toBe(eta.plannedArrivalAt);
    expect(eta.etaAt).toBeTruthy();

    // On the road: the projection from now, the same one the dispatcher's board shows.
    const at = new Date(`${DAY}T05:35:00+05:30`);
    await w.db
      .update(trips)
      .set({ status: 'IN_PROGRESS', startedAt: at })
      .where(eq(trips.id, trip.id));
    await w.db
      .update(stops)
      .set({
        status: 'DELIVERED',
        outcome: 'DELIVERED',
        arrivedAt: at,
        completedAt: at,
      })
      .where(eq(stops.id, tripStops[0].id));
    freezeClock(w.app, `${DAY}T05:40:00+05:30`);
    res = await get(store.cookie, `/orders/${stop.orderId}/eta`);
    expect(res.status).toBe(200);
    eta = data<OrderEtaDto>(res);
    const board = data<Board>(
      await call(
        w,
        'dispatcher',
        'get',
        `/depots/${day.depotId}/tracking?date=${DAY}`,
      ),
    );
    const onBoard = board.trips
      .flatMap((t) => t.stops)
      .find((s) => s.stopId === stop.id)!;
    expect(eta).toMatchObject({
      tripStatus: 'IN_PROGRESS',
      standing: 'NEXT',
      etaAt: onBoard.etaAt,
    });
    expect(eta.spareMin).toBeGreaterThan(0);
    // No vehicle, driver or position rides along.
    expect(Object.keys(eta).sort()).toEqual(
      [
        '_links',
        'completedAt',
        'etaAt',
        'orderId',
        'orderNo',
        'plannedArrivalAt',
        'spareMin',
        'standing',
        'stopId',
        'stopStatus',
        'tripStatus',
      ].sort(),
    );

    // Another outlet's order, and the depot's map, are not hers to see.
    res = await get(other.cookie, `/orders/${stop.orderId}/eta`);
    expectProblem(res, 'NOT_FOUND');
    expect(res.status).toBe(404);
    res = await get(
      store.cookie,
      `/depots/${day.depotId}/tracking?date=${DAY}`,
    );
    expect([403, 404]).toContain(res.status);
  });
});
