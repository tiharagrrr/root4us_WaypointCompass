import { and, eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { plans, stops, trips, users } from '../../../db/schema';
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

/** A published plan with one REF-07 trip carrying these orders, with the day's driver. */
async function publishedTrip(w: World, day: DepotDay, orderIds: string[]) {
  const key = `${day.codes.ref07}#1`;
  let p = data<PlanDto>(
    await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
  );
  const built = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
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
        ...orderIds.map((orderId) => ({
          op: 'ASSIGN_ORDER',
          orderId,
          tripKey: key,
        })),
        { op: 'SET_DRIVER', tripKey: key, driverId: day.driverId },
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
  const [trip] = await w.db
    .select()
    .from(trips)
    .where(
      and(eq(trips.planId, p.id), eq(trips.vehicleId, day.vehicles.ref07)),
    );
  return { plan: data<PlanDto>(pub), trip };
}

const tripRow = async (w: World, id: string) =>
  (await w.db.select().from(trips).where(eq(trips.id, id)))[0];

const setStatus = (w: World, id: string, status: 'RELEASED' | 'IN_PROGRESS') =>
  w.db
    .update(trips)
    .set({ status })
    .where(eq(trips.id, id))
    .returning()
    .then((r) => r[0]);

const op = (
  w: World,
  tripId: string,
  name: 'reassign' | 'resequence',
  version: number,
  body: Record<string, unknown>,
) =>
  call(w, 'dispatcher', 'post', `/trips/${tripId}/${name}`, {
    version,
    key: crypto.randomUUID(),
    body,
  });

describeWithDb('planning: trip operations (ROO-61)', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it('AC-PLN-23 reassigning a released trip', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 1 },
      b: { volumeM3: 1, outlet: 1 },
    });
    const { plan, trip } = await publishedTrip(w, day, [
      day.orders.a,
      day.orders.b,
    ]);
    const released = await setStatus(w, trip.id, 'RELEASED');
    // 19a offers both operations on the trip it reads.
    const read = data<{ _links: Record<string, unknown> }>(
      await call(w, 'dispatcher', 'get', `/trips/${trip.id}`),
    );
    expect(read._links.reassign).toMatchObject({ method: 'POST' });
    expect(read._links.resequence).toMatchObject({ method: 'POST' });

    // A reason is required.
    expectProblem(
      await op(w, trip.id, 'reassign', released.version, {
        vehicleId: day.vehicles.ref03,
      }),
      'VALIDATION_FAILED',
    );
    // A chilled trip cannot go on an ambient truck.
    const cold = await op(w, trip.id, 'reassign', released.version, {
      vehicleId: day.vehicles.dry31,
      reasonCode: 'VEHICLE_BREAKDOWN',
    });
    expectProblem(cold, 'PLAN_RULE_VIOLATION');
    expect(
      (cold.body as { violations: { rule: string }[] }).violations.map(
        (v) => v.rule,
      ),
    ).toContain('TEMP_REEFER');

    const res = await op(w, trip.id, 'reassign', released.version, {
      vehicleId: day.vehicles.ref03,
      reasonCode: 'VEHICLE_BREAKDOWN',
      note: 'REF-07 compressor fault',
    });
    expect(res.status).toBe(200);
    const moved = await tripRow(w, trip.id);
    expect(moved).toMatchObject({
      id: trip.id,
      vehicleId: day.vehicles.ref03,
      status: 'LOADING',
    });
    expect(await auditCount(w, PLANNING_AUDIT.tripReassigned, trip.id)).toBe(1);
    const [event] = await outboxOf(w, 'trip.reassigned', trip.id);
    expect(event.payload).toMatchObject({
      tripId: trip.id,
      vehicleId: day.vehicles.ref03,
      vehicleChanged: true,
    });
    const [after] = await w.db
      .select()
      .from(plans)
      .where(eq(plans.id, plan.id));
    expect(after.revision).toBe(2);

    // Only the driver, on the same vehicle: the trip stays RELEASED.
    const again = await setStatus(w, trip.id, 'RELEASED');
    const [nuwan] = await w.db
      .insert(users)
      .values({
        id: `drv-${crypto.randomUUID().slice(0, 8)}`,
        name: 'Nuwan Gunasekara',
        email: `nuwan-${crypto.randomUUID().slice(0, 8)}@drivers.waypoint.local`,
        role: 'driver',
        depotId: day.depotId,
      })
      .returning();
    const swap = await op(w, trip.id, 'reassign', again.version, {
      driverId: nuwan.id,
      reasonCode: 'OTHER',
    });
    expect(swap.status).toBe(200);
    expect(await tripRow(w, trip.id)).toMatchObject({
      status: 'RELEASED',
      driverId: nuwan.id,
      vehicleId: day.vehicles.ref03,
    });
  });

  it('AC-PLN-24 re-sequencing the stops left', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 1 },
      b: { volumeM3: 1, outlet: 1 },
      c: { volumeM3: 1, outlet: 2 },
    });
    const { trip } = await publishedTrip(w, day, [
      day.orders.a,
      day.orders.b,
      day.orders.c,
    ]);
    const running = await setStatus(w, trip.id, 'IN_PROGRESS');
    const pending = (
      await w.db.select().from(stops).where(eq(stops.tripId, trip.id))
    ).sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    const reversed = [...pending].reverse().map((s) => s.id);

    // Too late in the morning: the last stop would miss its 07:30 window.
    freezeClock(w.app, `${DAY}T07:20:00+05:30`);
    const late = await op(w, trip.id, 'resequence', running.version, {
      stopIds: reversed,
      reasonCode: 'OTHER',
    });
    expectProblem(late, 'PLAN_RULE_VIOLATION');
    expect(
      (late.body as { violations: { rule: string }[] }).violations.map(
        (v) => v.rule,
      ),
    ).toContain('WINDOW_OUTLET');
    const unchanged = await w.db
      .select()
      .from(stops)
      .where(eq(stops.tripId, trip.id));
    expect(
      unchanged.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0)).map((s) => s.id),
    ).toEqual(pending.map((s) => s.id));

    // Early enough: the new order holds, with no duplicate seq.
    freezeClock(w.app, `${DAY}T05:00:00+05:30`);
    const res = await op(w, trip.id, 'resequence', running.version, {
      stopIds: reversed,
      reasonCode: 'OTHER',
      note: 'Seeduwa first, the road to Ja-Ela is closed',
    });
    expect(res.status).toBe(200);
    const now = await w.db
      .select()
      .from(stops)
      .where(eq(stops.tripId, trip.id));
    const bySeq = now.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
    expect(bySeq.map((s) => s.id)).toEqual(reversed);
    expect(new Set(bySeq.map((s) => s.seq)).size).toBe(bySeq.length);
    expect(await auditCount(w, PLANNING_AUDIT.tripResequenced, trip.id)).toBe(
      1,
    );
    expect(await outboxOf(w, 'trip.resequenced', trip.id)).toHaveLength(1);

    // The ids must be exactly the pending stops.
    expectProblem(
      await op(w, trip.id, 'resequence', (await tripRow(w, trip.id)).version, {
        stopIds: reversed.slice(1),
        reasonCode: 'OTHER',
      }),
      'VALIDATION_FAILED',
    );
  });
});
