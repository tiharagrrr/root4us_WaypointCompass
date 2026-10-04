import { and, eq, inArray } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import {
  fuelLedgerEntries,
  orders,
  planRevisions,
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
  type DepotDay,
  type World,
} from './planning.world';

const plan = async (w: World, day: DepotDay) =>
  data<PlanDto>(
    await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
  );

const edit = (w: World, p: PlanDto, body: Record<string, unknown>) =>
  call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
    version: p.version,
    key: crypto.randomUUID(),
    body,
  });

/**
 * A published plan with REF-07 carrying a and b and REF-03 carrying c, each
 * with the day's driver. (Two vehicles rather than one vehicle's two trips:
 * a second Fresh run cannot meet the outlets' 05:30 to 07:30 window.)
 */
async function published(w: World) {
  const day = await depotDay(w, {
    a: { volumeM3: 1 },
    b: { volumeM3: 1, outlet: 1 },
    c: { volumeM3: 1, outlet: 2 },
  });
  const t1 = `${day.codes.ref07}#1`;
  const t2 = `${day.codes.ref03}#1`;
  const trip = (vehicleId: string) => ({
    op: 'ADD_TRIP',
    vehicleId,
    tripNo: 1,
    brand: 'FRESH',
    districtId: day.districtId,
  });
  let p = await plan(w, day);
  const built = await edit(w, p, {
    ops: [
      trip(day.vehicles.ref07),
      trip(day.vehicles.ref03),
      { op: 'ASSIGN_ORDER', orderId: day.orders.a, tripKey: t1 },
      { op: 'ASSIGN_ORDER', orderId: day.orders.b, tripKey: t1 },
      { op: 'ASSIGN_ORDER', orderId: day.orders.c, tripKey: t2 },
      { op: 'SET_DRIVER', tripKey: t1, driverId: day.driverId },
      { op: 'SET_DRIVER', tripKey: t2, driverId: day.driverId },
    ],
  });
  expect(built.status).toBe(200);
  p = data<PlanDto>(built);
  const pub = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
    version: p.version,
    key: crypto.randomUUID(),
  });
  expect(pub.status).toBe(200);
  p = data<PlanDto>(pub);
  const tripRows = await w.db
    .select()
    .from(trips)
    .where(and(eq(trips.planId, p.id), eq(trips.status, 'PLANNED')));
  const on = (vehicleId: string) =>
    tripRows.find((t) => t.vehicleId === vehicleId)!;
  return {
    day,
    p,
    t1,
    t2,
    trip1: on(day.vehicles.ref07),
    trip2: on(day.vehicles.ref03),
  };
}

const orderRow = async (w: World, id: string) =>
  (await w.db.select().from(orders).where(eq(orders.id, id)))[0];

const fuelOf = (w: World, tripId: string) =>
  w.db
    .select()
    .from(fuelLedgerEntries)
    .where(eq(fuelLedgerEntries.tripId, tripId));

describeWithDb('planning: revisions after publish (ROO-42)', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it('AC-PLN-21 a change after publishing is a revision', async () => {
    const { day, p, t2, trip1, trip2 } = await published(w);
    expect(p._links.edits).toMatchObject({ title: 'Save as revision' });
    const fuelBefore = {
      [trip1.id]: trip1.plannedFuelL,
      [trip2.id]: trip2.plannedFuelL,
    };
    const move = {
      op: 'MOVE_ORDER',
      orderId: day.orders.a,
      tripKey: t2,
    };

    // A reason is required, and nothing changes without one.
    const refused = await edit(w, p, { ops: [move] });
    expectProblem(refused, 'VALIDATION_FAILED');
    expect(
      (refused.body as { errors: { field: string; message: string }[] }).errors,
    ).toEqual([
      expect.objectContaining({
        field: 'reasonCode',
        message: 'A reason is required',
      }),
    ]);

    const res = await edit(w, p, {
      ops: [move],
      reasonCode: 'OVER_CAPACITY',
      note: 'Trip 1 runs late; Kadawatha goes on the second run',
    });
    expect(res.status).toBe(200);
    const revised = data<PlanDto>(res);
    expect(revised).toMatchObject({
      status: 'PUBLISHED',
      revision: 2,
      version: p.version + 1,
    });

    const [row] = await w.db
      .select()
      .from(planRevisions)
      .where(
        and(eq(planRevisions.planId, p.id), eq(planRevisions.revision, 2)),
      );
    expect(row).toMatchObject({
      reasonCode: 'OVER_CAPACITY',
      note: 'Trip 1 runs late; Kadawatha goes on the second run',
      changes: [move],
    });
    expect([...row.affectedTripIds].sort()).toEqual(
      [trip1.id, trip2.id].sort(),
    );
    const a = await orderRow(w, day.orders.a);
    expect(row.affectedOutletIds).toEqual([a.outletId]);

    // The order is still PLANNED, now on trip 2's stop.
    expect(a.status).toBe('PLANNED');
    const [stop] = await w.db
      .select()
      .from(stops)
      .where(eq(stops.id, a.activeStopId!));
    expect(stop).toMatchObject({ tripId: trip2.id, status: 'PENDING' });

    expect(await auditCount(w, PLANNING_AUDIT.planRevised, p.id)).toBe(1);
    const events = await outboxOf(w, 'plan.revised', p.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      v: 1,
      revision: 2,
      reasonCode: 'OVER_CAPACITY',
    });
    expect(
      [...(events[0].payload as { tripIds: string[] }).tripIds].sort(),
    ).toEqual([trip1.id, trip2.id].sort());
    expect(events[0].outletIds).toEqual([a.outletId]);

    // The fuel ledger takes back each trip's earlier plan and books the new one.
    const now = await w.db
      .select()
      .from(trips)
      .where(inArray(trips.id, [trip1.id, trip2.id]));
    for (const t of now) {
      const entries = await fuelOf(w, t.id);
      expect(entries).toContainEqual(
        expect.objectContaining({
          kind: 'PLANNED',
          litres: -fuelBefore[t.id],
        }),
      );
      expect(entries.reduce((n, e) => n + e.litres, 0)).toBeCloseTo(
        t.plannedFuelL,
        6,
      );
    }

    // The history lists both revisions, newest first.
    const history = data<{ revision: number }[]>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/revisions`),
    );
    expect(history.map((r) => r.revision)).toEqual([2, 1]);
  });

  it('an order taken off every trip after publishing goes back to the queue', async () => {
    const { day, p } = await published(w);
    const res = await edit(w, p, {
      ops: [{ op: 'UNASSIGN_ORDER', orderId: day.orders.c }],
      reasonCode: 'OVER_CAPACITY',
    });
    expect(res.status).toBe(200);
    expect(await orderRow(w, day.orders.c)).toMatchObject({
      status: 'CONFIRMED',
      activeStopId: null,
    });
  });

  it('AC-FLT-01 planned fuel counts against the quota', async () => {
    const day = await depotDay(w, { a: { volumeM3: 1 } });
    // REF-07's quota is 400 L; earlier planned trips this week leave half a litre.
    await w.db.insert(fuelLedgerEntries).values({
      vehicleId: day.vehicles.ref07,
      isoYear: 2026,
      isoWeek: 40,
      date: '2026-09-29',
      kind: 'PLANNED',
      km: 1997.5,
      litres: 399.5,
    });
    const p = await plan(w, day);
    const res = await edit(w, p, {
      ops: [
        {
          op: 'ADD_TRIP',
          vehicleId: day.vehicles.ref07,
          tripNo: 1,
          brand: 'FRESH',
          districtId: day.districtId,
        },
        {
          op: 'ASSIGN_ORDER',
          orderId: day.orders.a,
          tripKey: `${day.codes.ref07}#1`,
        },
      ],
    });
    expectProblem(res, 'PLAN_RULE_VIOLATION');
    expect(
      (
        res.body as {
          violations: { rule: string; severity: string; limit: number }[];
        }
      ).violations,
    ).toContainEqual(
      expect.objectContaining({
        rule: 'FUEL_WEEKLY',
        severity: 'HARD',
        limit: 400,
      }),
    );
    expect((await plan(w, day)).version).toBe(p.version);

    const options = data<{ vehicleId: string; fuelLeftL: number }[]>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/vehicle-options`),
    );
    expect(
      options.find((o) => o.vehicleId === day.vehicles.ref07)?.fuelLeftL,
    ).toBeCloseTo(0.5, 6);
  });

  it('AC-PLN-22 released trips take three changes only', async () => {
    const { day, p, t2, trip1 } = await published(w);
    await w.db
      .update(trips)
      .set({ status: 'RELEASED' })
      .where(eq(trips.id, trip1.id));

    const res = await edit(w, p, {
      ops: [{ op: 'MOVE_ORDER', orderId: day.orders.a, tripKey: t2 }],
      reasonCode: 'OVER_CAPACITY',
    });
    expectProblem(res, 'CONFLICT_STATE');
    expect((await plan(w, day)).revision).toBe(1);
    expect(await orderRow(w, day.orders.a)).toMatchObject({
      status: 'PLANNED',
    });
    expect(await outboxOf(w, 'plan.revised', p.id)).toHaveLength(0);
  });
});
