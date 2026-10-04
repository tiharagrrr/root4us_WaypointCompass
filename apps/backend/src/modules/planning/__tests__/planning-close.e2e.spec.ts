import { and, eq, inArray } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import {
  deferrals,
  fuelLedgerEntries,
  orders,
  plans,
  stops,
  trips,
} from '../../../db/schema';
import type { PlanDto } from '../dto/plan.dto';
import { PLANNING_AUDIT } from '../planning.constants';
import {
  auditCount,
  buildWorld,
  call,
  data,
  DAY,
  depotDay,
  OPEN,
  outboxOf,
  tearDown,
  type World,
} from './planning.world';

interface EndOfDay {
  status: string;
  totals: {
    stops: number;
    delivered: number;
    partial: number;
    failed: number;
    unserved: number;
    deferred: number;
  };
  trips: {
    tripId: string;
    vehicleCode: string;
    stops: number;
    delivered: number;
    failed: number;
    status: string;
  }[];
  followUps: { kind: string; title: string }[];
  closeBlockers: string[];
  _links: Record<string, { href: string; method?: string } | undefined>;
}

/**
 * The day after the runs: REF-07 delivered a and never reached b; REF-03
 * failed c (outlet closed). REF-03 is still on the road until a test
 * completes it.
 */
async function afterTheRuns(w: World) {
  const day = await depotDay(w, {
    a: { volumeM3: 1 },
    b: { volumeM3: 1, outlet: 1 },
    c: { volumeM3: 1, outlet: 2 },
  });
  const trip = (vehicleId: string) => ({
    op: 'ADD_TRIP',
    vehicleId,
    tripNo: 1,
    brand: 'FRESH',
    districtId: day.districtId,
  });
  const t1 = `${day.codes.ref07}#1`;
  const t2 = `${day.codes.ref03}#1`;
  let p = data<PlanDto>(
    await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
  );
  const built = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
    version: p.version,
    key: crypto.randomUUID(),
    body: {
      ops: [
        trip(day.vehicles.ref07),
        trip(day.vehicles.ref03),
        { op: 'ASSIGN_ORDER', orderId: day.orders.a, tripKey: t1 },
        { op: 'ASSIGN_ORDER', orderId: day.orders.b, tripKey: t1 },
        { op: 'ASSIGN_ORDER', orderId: day.orders.c, tripKey: t2 },
        { op: 'SET_DRIVER', tripKey: t1, driverId: day.driverId },
        { op: 'SET_DRIVER', tripKey: t2, driverId: day.driverId },
      ],
    },
  });
  expect(built.status).toBe(200);
  p = data<PlanDto>(built);
  const pub = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
    version: p.version,
    key: crypto.randomUUID(),
  });
  expect(pub.status).toBe(200);
  p = data<PlanDto>(pub);

  // What execution would have recorded during the day.
  const tripRows = await w.db
    .select()
    .from(trips)
    .where(eq(trips.planId, p.id));
  const ref07 = tripRows.find((t) => t.vehicleId === day.vehicles.ref07)!;
  const ref03 = tripRows.find((t) => t.vehicleId === day.vehicles.ref03)!;
  const stopOf = async (orderId: string) =>
    (await w.db.select().from(stops).where(eq(stops.orderId, orderId)))[0];
  const [sa, sb, sc] = [
    await stopOf(day.orders.a),
    await stopOf(day.orders.b),
    await stopOf(day.orders.c),
  ];
  const at = new Date('2026-10-02T06:10:00+05:30');
  await w.db
    .update(trips)
    .set({ status: 'COMPLETED', startedAt: at, completedAt: at })
    .where(eq(trips.id, ref07.id));
  await w.db
    .update(trips)
    .set({ status: 'IN_PROGRESS', startedAt: at })
    .where(eq(trips.id, ref03.id));
  await w.db
    .update(stops)
    .set({
      status: 'DELIVERED',
      outcome: 'DELIVERED',
      arrivedAt: at,
      completedAt: at,
    })
    .where(eq(stops.id, sa.id));
  await w.db
    .update(stops)
    .set({
      status: 'FAILED',
      outcome: 'OUTLET_CLOSED',
      arrivedAt: at,
      completedAt: at,
      exceptionNote: 'Shutters down at 06:10',
    })
    .where(eq(stops.id, sc.id));
  await w.db
    .update(orders)
    .set({ status: 'DELIVERED' })
    .where(eq(orders.id, day.orders.a));
  await w.db
    .update(orders)
    .set({ status: 'IN_TRANSIT' })
    .where(eq(orders.id, day.orders.b));
  await w.db
    .update(orders)
    .set({ status: 'FAILED' })
    .where(eq(orders.id, day.orders.c));
  return { day, p, ref07, ref03, sb };
}

const close = (w: World, p: PlanDto, version = p.version) =>
  call(w, 'dispatcher', 'post', `/plans/${p.id}/close`, {
    version,
    key: crypto.randomUUID(),
  });

const endOfDay = async (w: World, id: string) =>
  data<EndOfDay>(await call(w, 'dispatcher', 'get', `/plans/${id}/end-of-day`));

describeWithDb('planning: closing the day (ROO-61)', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it('21 the end of day lists each trip, what needs following up, and what blocks closing', async () => {
    const { p, ref03 } = await afterTheRuns(w);
    const eod = await endOfDay(w, p.id);
    expect(eod).toMatchObject({
      status: 'PUBLISHED',
      totals: { stops: 3, delivered: 1, partial: 0, failed: 1, unserved: 1 },
    });
    expect(eod.trips.find((t) => t.tripId === ref03.id)).toMatchObject({
      stops: 1,
      failed: 1,
      status: 'IN_PROGRESS',
    });
    expect(eod.followUps).toContainEqual(
      expect.objectContaining({ kind: 'FAILED_STOP' }),
    );
    expect(eod.closeBlockers).toHaveLength(1);
    expect(eod._links.close).toBeUndefined();
  });

  it('AC-PLN-29 closing the day', async () => {
    const { day, p, ref07, ref03, sb } = await afterTheRuns(w);

    // Not while a trip is on the road.
    expectProblem(await close(w, p), 'CONFLICT_STATE');
    expect((await endOfDay(w, p.id)).status).toBe('PUBLISHED');

    await w.db
      .update(trips)
      .set({ status: 'COMPLETED', completedAt: new Date(OPEN) })
      .where(eq(trips.id, ref03.id));
    const ready = await endOfDay(w, p.id);
    expect(ready.closeBlockers).toEqual([]);
    expect(ready._links.close).toMatchObject({ method: 'POST' });

    const res = await close(w, p);
    expect(res.status).toBe(200);
    const closed = data<PlanDto>(res);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).toBe(new Date(OPEN).toISOString());
    const [row] = await w.db.select().from(plans).where(eq(plans.id, p.id));
    expect(row.closedById).toBeTruthy();

    // The unserved stop and the failed one become deferrals to the next run.
    const rows = await w.db
      .select()
      .from(deferrals)
      .where(
        and(
          eq(deferrals.planId, p.id),
          inArray(deferrals.orderId, [day.orders.b, day.orders.c]),
        ),
      );
    expect(rows).toHaveLength(2);
    for (const d of rows)
      expect(d).toMatchObject({
        status: 'CONFIRMED',
        fromDate: DAY,
        toDate: '2026-10-03',
      });
    expect(rows.find((d) => d.orderId === day.orders.c)?.note).toContain(
      'Shutters down at 06:10',
    );
    const after = await w.db
      .select()
      .from(orders)
      .where(inArray(orders.id, [day.orders.b, day.orders.c]));
    for (const o of after)
      expect(o).toMatchObject({
        status: 'DEFERRED',
        deliveryDate: '2026-10-03',
      });
    expect(
      (await w.db.select().from(stops).where(eq(stops.id, sb.id)))[0]?.status,
    ).toBe('CANCELLED');
    for (const d of rows)
      expect(await outboxOf(w, 'deferral.confirmed', d.id)).toHaveLength(1);

    // Each completed trip's fuel is now an ACTUAL entry, and counts once.
    for (const t of [ref07, ref03]) {
      const fuel = await w.db
        .select()
        .from(fuelLedgerEntries)
        .where(eq(fuelLedgerEntries.tripId, t.id));
      expect(fuel).toContainEqual(
        expect.objectContaining({ kind: 'ACTUAL', litres: t.plannedFuelL }),
      );
      expect(fuel.reduce((n, e) => n + e.litres, 0)).toBeCloseTo(
        t.plannedFuelL,
        6,
      );
    }

    expect(await auditCount(w, PLANNING_AUDIT.planClosed, p.id)).toBe(1);
    expect(await outboxOf(w, 'plan.closed', p.id)).toHaveLength(1);

    // A closed plan takes no edits.
    const edit = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
      version: closed.version,
      key: crypto.randomUUID(),
      body: {
        ops: [{ op: 'UNASSIGN_ORDER', orderId: day.orders.a }],
        reasonCode: 'OTHER',
      },
    });
    expectProblem(edit, 'PLAN_LOCKED');
    expect((await endOfDay(w, p.id))._links.close).toBeUndefined();
  });
});
