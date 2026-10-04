import { and, eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import { EventBus } from '../../../core/outbox/event-bus';
import { alerts, planRevisions, trips, vehicles } from '../../../db/schema';
import type { PlanDto } from '../dto/plan.dto';
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

/**
 * The relay's delivery of the newest outbox row of a type for an aggregate
 * to every consumer of it, as ROO-24 does it.
 */
async function relay(w: World, type: string, aggregateId: string) {
  const rows = await outboxOf(w, type, aggregateId);
  const row = rows.at(-1)!;
  for (const consumer of w.app.get(EventBus).consumersOf(type))
    await w.app
      .get(JobContextRunner)
      .run({ id: `test:relay:${row.id}` }, () => consumer.handle(row));
}

const setStatus = (
  w: World,
  role: 'dispatcher' | 'loader' | 'kandy',
  vehicleId: string,
  version: number,
  body: Record<string, unknown>,
) =>
  call(w, role, 'put', `/vehicles/${vehicleId}/status`, {
    version,
    body,
  });

describeWithDb('planning: breakdown repair (ROO-56)', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));

  it('AC-FLT-05 a breakdown takes a vehicle out', async () => {
    const day = await depotDay(w, { a: { volumeM3: 1 } });
    const [ref07] = await w.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, day.vehicles.ref07));

    expectProblem(
      await setStatus(w, 'dispatcher', ref07.id, ref07.version, {
        status: 'BREAKDOWN',
      }),
      'VALIDATION_FAILED',
    );
    expectProblem(
      await setStatus(w, 'loader', ref07.id, ref07.version, {
        status: 'BREAKDOWN',
        reason: 'x',
      }),
      'FORBIDDEN',
    );
    expectProblem(
      await setStatus(w, 'kandy', ref07.id, ref07.version, {
        status: 'BREAKDOWN',
        reason: 'x',
      }),
      'NOT_FOUND',
    );

    const res = await setStatus(w, 'dispatcher', ref07.id, ref07.version, {
      status: 'BREAKDOWN',
      reason: 'Compressor fault',
    });
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({
      id: ref07.id,
      status: 'BREAKDOWN',
      statusReason: 'Compressor fault',
      statusChangedAt: OPEN,
      version: ref07.version + 1,
    });
    expect(await auditCount(w, 'fleet.vehicle.status_changed', ref07.id)).toBe(
      1,
    );
    expect(await outboxOf(w, 'vehicle.status_changed', ref07.id)).toHaveLength(
      1,
    );

    // A stale version loses.
    expectProblem(
      await setStatus(w, 'dispatcher', ref07.id, ref07.version, {
        status: 'ACTIVE',
        reason: 'Fixed',
      }),
      'VERSION_MISMATCH',
    );
  });

  it('AC-PLN-06 a breakdown after publishing becomes revision 2', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 1 },
      b: { volumeM3: 1, outlet: 1 },
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
            { op: 'ASSIGN_ORDER', orderId: day.orders.a, tripKey: key },
            { op: 'ASSIGN_ORDER', orderId: day.orders.b, tripKey: key },
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

    // REF-07 breaks down: planning marks its unreleased trip, and alerts raises it.
    const [ref07] = await w.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, day.vehicles.ref07));
    expect(
      (
        await setStatus(w, 'dispatcher', ref07.id, ref07.version, {
          status: 'BREAKDOWN',
          reason: 'Compressor fault',
        })
      ).status,
    ).toBe(200);
    await relay(w, 'vehicle.status_changed', ref07.id);
    const [marked] = await w.db
      .select()
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(marked.cantRunReason).toBe('BREAKDOWN');
    const cantRun = await outboxOf(w, 'trip.cant_run', trip.id);
    expect(cantRun).toHaveLength(1);
    expect(cantRun[0].payload).toMatchObject({
      tripId: trip.id,
      reason: 'BREAKDOWN',
    });
    await relay(w, 'trip.cant_run', trip.id);
    const raised = await w.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.tripId, trip.id), eq(alerts.status, 'OPEN')));
    expect(raised).toHaveLength(1);

    // The repair: the engine checks each other vehicle for the trip.
    const options = data<
      { vehicleId: string; fits: boolean; rules: string[] }[]
    >(await call(w, 'dispatcher', 'get', `/trips/${trip.id}/repair-options`));
    expect(
      options.find((o) => o.vehicleId === day.vehicles.ref03),
    ).toMatchObject({ fits: true, rules: [] });
    const dry = options.find((o) => o.vehicleId === day.vehicles.dry31);
    expect(dry?.fits).toBe(false);
    expect(dry?.rules).toContain('TEMP_REEFER');
    expect(options.some((o) => o.vehicleId === day.vehicles.ref07)).toBe(false);

    // Applying it is the reassign: revision 2, and the alert clears.
    const res = await call(
      w,
      'dispatcher',
      'post',
      `/trips/${trip.id}/reassign`,
      {
        version: marked.version,
        key: crypto.randomUUID(),
        body: {
          vehicleId: day.vehicles.ref03,
          reasonCode: 'VEHICLE_BREAKDOWN',
          note: 'REF-07 compressor fault',
        },
      },
    );
    expect(res.status).toBe(200);
    const [after] = await w.db
      .select()
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after).toMatchObject({
      vehicleId: day.vehicles.ref03,
      cantRunReason: null,
    });
    const [rev] = await w.db
      .select()
      .from(planRevisions)
      .where(
        and(eq(planRevisions.planId, p.id), eq(planRevisions.revision, 2)),
      );
    expect(rev).toMatchObject({ reasonCode: 'VEHICLE_BREAKDOWN' });
    expect(rev.affectedTripIds).toEqual([trip.id]);
    await relay(w, 'trip.reassigned', trip.id);
    expect(
      await w.db
        .select()
        .from(alerts)
        .where(and(eq(alerts.tripId, trip.id), eq(alerts.status, 'OPEN'))),
    ).toHaveLength(0);
  });
});
