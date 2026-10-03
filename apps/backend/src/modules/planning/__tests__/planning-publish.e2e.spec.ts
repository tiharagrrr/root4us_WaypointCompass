import { and, eq, inArray } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import {
  auditEvents,
  deferrals,
  fuelLedgerEntries,
  orders,
  planRevisions,
  stops,
  trips,
  vehicles,
} from '../../../db/schema';
import type {
  PublishPreviewDto,
  UnplannedOrderDto,
} from '../dto/plan-actions.dto';
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

const current = async (w: World, id: string) =>
  data<PlanDto>(await call(w, 'dispatcher', 'get', `/plans/${id}`));

/** One trip on REF-07 with these orders and the day's driver. */
async function tripWith(
  w: World,
  day: DepotDay,
  orderIds: string[],
  driver = true,
) {
  const p = await plan(w, day);
  const key = `${day.codes.ref07}#1`;
  const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
    version: p.version,
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
        ...(driver
          ? [{ op: 'SET_DRIVER', tripKey: key, driverId: day.driverId }]
          : []),
      ],
    },
  });
  expect(res.status).toBe(200);
  return data<PlanDto>(res);
}

const decide = (w: World, p: PlanDto, decisions: Record<string, unknown>[]) =>
  call(w, 'dispatcher', 'post', `/plans/${p.id}/deferrals/decisions`, {
    version: p.version,
    key: crypto.randomUUID(),
    body: { decisions },
  });

const deferralOf = async (w: World, orderId: string) =>
  (
    await w.db.select().from(deferrals).where(eq(deferrals.orderId, orderId))
  ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

describeWithDb('planning: decisions and publish', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it('AC-PLN-16 confirming a deferral', async () => {
    const day = await depotDay(w, { a: { volumeM3: 1 } });
    const p = await plan(w, day);

    const noNote = await decide(w, p, [
      { orderId: day.orders.a, action: 'DEFER', reasonCode: 'OVER_CAPACITY' },
    ]);
    expect(expectProblem(noNote, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'decisions[0].note' }),
    ]);
    expectProblem(
      await decide(w, p, [
        { orderId: day.orders.a, action: 'DEFER', note: 'x' },
      ]),
      'VALIDATION_FAILED',
    );

    const ok = await decide(w, p, [
      {
        orderId: day.orders.a,
        action: 'DEFER',
        reasonCode: 'OVER_CAPACITY',
        note: 'First on tomorrow’s run',
      },
    ]);
    expect(ok.status).toBe(200);
    const [row] = await deferralOf(w, day.orders.a);
    expect(row).toMatchObject({
      status: 'CONFIRMED',
      source: 'PLANNING',
      reasonCode: 'OVER_CAPACITY',
      note: 'First on tomorrow’s run',
      toDate: '2026-10-03',
    });
    expect(row.decidedById).toBeTruthy();
    expect(row.decidedAt?.toISOString()).toBe(new Date(OPEN).toISOString());
    const audit = await w.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, PLANNING_AUDIT.deferralConfirmed),
          eq(auditEvents.entityId, row.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].reasonCode).toBe('OVER_CAPACITY');
    // The store hears about it at publish, not now (decided 2026-10-03).
    expect(await outboxOf(w, 'deferral.confirmed', row.id)).toHaveLength(0);

    const listed = data<UnplannedOrderDto[]>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/unplanned`),
    );
    expect(listed).toEqual([
      expect.objectContaining({
        orderId: day.orders.a,
        deferralStatus: 'CONFIRMED',
        reasonCode: 'OVER_CAPACITY',
        reasonLabel: 'Fleet full',
      }),
    ]);
  });

  it('AC-PLN-05 a repeat skip needs an override note', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 1, status: 'DEFERRED', deferredCount: 1 },
    });
    const p = await plan(w, day);
    const listed = data<UnplannedOrderDto[]>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/unplanned`),
    );
    expect(listed[0]).toMatchObject({
      orderId: day.orders.a,
      repeatSkip: true,
    });

    const decision = {
      orderId: day.orders.a,
      action: 'DEFER',
      reasonCode: 'OVER_CAPACITY',
      note: 'Sorry, tomorrow',
    };
    const refused = await decide(w, p, [decision]);
    expect(expectProblem(refused, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'decisions[0].overrideNote' }),
    ]);
    expect(await deferralOf(w, day.orders.a)).toHaveLength(0);

    const ok = await decide(w, p, [
      { ...decision, overrideNote: 'Every reefer is full again' },
    ]);
    expect(ok.status).toBe(200);
    const [row] = await deferralOf(w, day.orders.a);
    expect(row).toMatchObject({
      status: 'CONFIRMED',
      overrideNote: 'Every reefer is full again',
      repeatSkip: true,
    });
    expect(await auditCount(w, PLANNING_AUDIT.deferralConfirmed, row.id)).toBe(
      1,
    );
    expect(
      await auditCount(w, PLANNING_AUDIT.repeatSkipOverridden, row.id),
    ).toBe(1);
  });

  it('AC-PLN-17 planning an unplanned order on a trip', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 2 },
      b: { volumeM3: 2, outlet: 1 },
      big: { volumeM3: 11, outlet: 2 },
    });
    let p = await tripWith(w, day, [day.orders.a]);
    const [proposed] = await w.db
      .insert(deferrals)
      .values({
        orderId: day.orders.b,
        planId: p.id,
        source: 'ENGINE',
        reasonCode: 'OVER_CAPACITY',
        fromDate: DAY,
        toDate: '2026-10-03',
      })
      .returning();

    const res = await decide(w, p, [
      {
        orderId: day.orders.b,
        action: 'PLAN_ON',
        reasonCode: 'STORE_REQUEST',
        tripKey: `${day.codes.ref07}#1`,
      },
    ]);
    expect(res.status).toBe(200);
    p = data<PlanDto>(res);
    const [trip] = await w.db
      .select()
      .from(trips)
      .where(
        and(eq(trips.planId, p.id), eq(trips.vehicleId, day.vehicles.ref07)),
      );
    const onTrip = await w.db
      .select()
      .from(stops)
      .where(and(eq(stops.tripId, trip.id), eq(stops.orderId, day.orders.b)));
    expect(onTrip).toHaveLength(1);
    const [after] = await w.db
      .select()
      .from(deferrals)
      .where(eq(deferrals.id, proposed.id));
    expect(after.status).toBe('CANCELLED');
    const listed = data<UnplannedOrderDto[]>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/unplanned`),
    );
    expect(listed.map((u) => u.orderId)).toEqual([day.orders.big]);

    const tooBig = await decide(w, p, [
      {
        orderId: day.orders.big,
        action: 'PLAN_ON',
        reasonCode: 'STORE_REQUEST',
        tripKey: `${day.codes.ref07}#1`,
      },
    ]);
    expect(tooBig.status).toBe(422);
    expectProblem(tooBig, 'PLAN_RULE_VIOLATION');
    expect((await current(w, p.id)).version).toBe(p.version);
  });

  it('AC-PLN-18 swapping serves a repeat skip', async () => {
    const day = await depotDay(w, {
      b: { volumeM3: 6 },
      keep: { volumeM3: 5.5, outlet: 1 },
      a: { volumeM3: 1, outlet: 2, status: 'DEFERRED', deferredCount: 1 },
    });
    const p = await tripWith(w, day, [day.orders.b, day.orders.keep]);
    const res = await decide(w, p, [
      {
        orderId: day.orders.a,
        action: 'SWAP',
        reasonCode: 'STORE_REQUEST',
        tripKey: `${day.codes.ref07}#1`,
        swapOrderId: day.orders.b,
        swapReasonCode: 'OVER_CAPACITY',
        swapNote: 'A store skipped yesterday goes first',
      },
    ]);
    expect(res.status).toBe(200);
    const [trip] = await w.db
      .select()
      .from(trips)
      .where(
        and(eq(trips.planId, p.id), eq(trips.vehicleId, day.vehicles.ref07)),
      );
    const live = await w.db
      .select()
      .from(stops)
      .where(and(eq(stops.tripId, trip.id), eq(stops.status, 'PENDING')));
    expect(live.map((s) => s.orderId).sort()).toEqual(
      [day.orders.a, day.orders.keep].sort(),
    );
    const [b] = await deferralOf(w, day.orders.b);
    expect(b).toMatchObject({
      status: 'CONFIRMED',
      reasonCode: 'OVER_CAPACITY',
    });
    const swapped = await w.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, PLANNING_AUDIT.orderSwapped),
          eq(auditEvents.entityId, p.id),
        ),
      );
    expect(swapped).toHaveLength(1);
    expect(swapped[0].after).toEqual({
      deferredOrderId: day.orders.b,
      addedOrderId: day.orders.a,
      tripId: trip.id,
    });
    expect(await auditCount(w, PLANNING_AUDIT.deferralConfirmed, b.id)).toBe(1);
  });

  it('AC-PLN-03 publishing before it opens is locked', async () => {
    const day = await depotDay(w);
    const p = await plan(w, day);
    freezeClock(w.app, '2026-10-01T15:59:00+05:30');
    const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
      version: p.version,
    });
    const problem = expectProblem(res, 'PLAN_LOCKED') as unknown as {
      opensAt: string;
    };
    expect(res.status).toBe(409);
    expect(problem.opensAt).toBe(
      new Date('2026-10-01T16:00:00+05:30').toISOString(),
    );
    expect(await current(w, p.id)).toMatchObject({
      status: 'DRAFT',
      revision: 0,
    });
    const preview = data<PublishPreviewDto>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/publish-preview`),
    );
    expect(preview).toMatchObject({ opensAt: problem.opensAt, open: false });
  });

  it('AC-PLN-04 an undecided unplanned order blocks publishing', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 1 },
      wait: { volumeM3: 1, outlet: 1 },
    });
    const p = await tripWith(w, day, [day.orders.a]);
    const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
      version: p.version,
    });
    expect(res.status).toBe(409);
    const problem = expectProblem(res, 'CONFLICT_STATE') as unknown as {
      blockers: { kind: string; orderId?: string }[];
    };
    expect(problem.blockers).toEqual([
      expect.objectContaining({
        kind: 'UNDECIDED_ORDER',
        orderId: day.orders.wait,
      }),
    ]);
    expect(await current(w, p.id)).toMatchObject({
      status: 'DRAFT',
      revision: 0,
    });
    const [a] = await w.db
      .select()
      .from(orders)
      .where(eq(orders.id, day.orders.a));
    expect(a.status).toBe('CONFIRMED');
    expect(await outboxOf(w, 'plan.published', p.id)).toHaveLength(0);
    const preview = data<PublishPreviewDto>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/publish-preview`),
    );
    expect(preview.blockers.map((b) => b.orderId)).toContain(day.orders.wait);
    expect(preview._links.publish).toBeUndefined();
  });

  it('AC-PLN-20 other blockers stop publishing', async () => {
    const day = await depotDay(w, { a: { volumeM3: 1, weightKg: 900 } });
    const p = await tripWith(w, day, [day.orders.a], false);
    // The truck's capacity was lowered after the trip was built.
    await w.db
      .update(vehicles)
      .set({ weightCapKg: 500 })
      .where(eq(vehicles.id, day.vehicles.ref07));
    const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
      version: p.version,
    });
    const problem = expectProblem(res, 'CONFLICT_STATE') as unknown as {
      blockers: { kind: string; rule?: string }[];
    };
    expect(problem.blockers.map((b) => b.kind).sort()).toEqual([
      'HARD_VIOLATION',
      'NO_DRIVER',
    ]);
    expect(
      problem.blockers.find((b) => b.kind === 'HARD_VIOLATION')?.rule,
    ).toBe('CAP_WEIGHT');
    const preview = data<PublishPreviewDto>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/publish-preview`),
    );
    expect(preview.open).toBe(true);
    expect(preview.blockers.map((b) => b.kind)).toContain('NO_DRIVER');
    expect(preview.notify.drivers).toBe(0);
  });

  it('AC-PLN-19 publishing commits the day', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 2 },
      b: { volumeM3: 2, outlet: 1 },
      c: { volumeM3: 2, outlet: 2 },
    });
    let p = await tripWith(w, day, [day.orders.a, day.orders.b]);
    p = data<PlanDto>(
      await decide(w, p, [
        {
          orderId: day.orders.c,
          action: 'DEFER',
          reasonCode: 'OVER_CAPACITY',
          note: 'Tomorrow, first stop',
        },
      ]),
    );
    expect(p._links.publish).toBeDefined();

    const key = crypto.randomUUID();
    const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
      version: p.version,
      key,
    });
    expect(res.status).toBe(200);
    const published = data<PlanDto>(res);
    expect(published).toMatchObject({
      status: 'PUBLISHED',
      revision: 1,
      publishedAt: new Date(OPEN).toISOString(),
    });
    expect(published.publishedById).toBeTruthy();
    expect(published._links.publish).toBeUndefined();

    expect(
      await w.db
        .select()
        .from(planRevisions)
        .where(eq(planRevisions.planId, p.id)),
    ).toEqual([
      expect.objectContaining({ revision: 1, reasonCode: 'PUBLISH' }),
    ]);
    const rows = await w.db
      .select()
      .from(orders)
      .where(inArray(orders.id, Object.values(day.orders)));
    const byId = new Map(rows.map((o) => [o.id, o]));
    for (const id of [day.orders.a, day.orders.b]) {
      expect(byId.get(id)).toMatchObject({ status: 'PLANNED' });
      expect(byId.get(id)?.activeStopId).toBeTruthy();
    }
    expect(byId.get(day.orders.c)).toMatchObject({
      status: 'DEFERRED',
      deliveryDate: '2026-10-03',
      deferredCount: 1,
    });

    const [trip] = await w.db
      .select()
      .from(trips)
      .where(
        and(eq(trips.planId, p.id), eq(trips.vehicleId, day.vehicles.ref07)),
      );
    const fuel = await w.db
      .select()
      .from(fuelLedgerEntries)
      .where(eq(fuelLedgerEntries.tripId, trip.id));
    expect(fuel).toEqual([
      expect.objectContaining({
        kind: 'PLANNED',
        litres: trip.plannedFuelL,
        km: trip.plannedKm,
        isoWeek: 40,
        date: DAY,
      }),
    ]);
    expect(trip.plannedFuelL).toBeCloseTo(trip.plannedKm / 5);

    expect(await auditCount(w, PLANNING_AUDIT.planPublished, p.id)).toBe(1);
    const [event] = await outboxOf(w, 'plan.published', p.id);
    expect(event.payload).toMatchObject({
      v: 1,
      revision: 1,
      tripIds: [trip.id],
    });
    const [c] = await deferralOf(w, day.orders.c);
    expect(await outboxOf(w, 'deferral.confirmed', c.id)).toHaveLength(1);

    const replay = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${p.id}/publish`,
      { version: p.version, key },
    );
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await outboxOf(w, 'plan.published', p.id)).toHaveLength(1);
  });
});
