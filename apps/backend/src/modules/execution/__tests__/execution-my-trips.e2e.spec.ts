import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import {
  at,
  auditRows,
  buildWorld,
  call,
  data,
  eventRows,
  outboxRows,
  resetTrips,
  seedTrip,
  stopRow,
  tearDownWorld,
  tripRow,
  type World,
} from './execution.world';

/** A trip as D1, D10 and D14 read it. */
interface TripSummary {
  id: string;
  tripNo: number | null;
  status: string;
  date: string;
  vehicle: { id: string; code: string; temp: string };
  stops: number;
  version: number;
  _links: Record<string, { href: string; method?: string }>;
}

describeWithDb('execution: the driver reads her own trips', () => {
  let world: World;

  beforeAll(async () => {
    world = await buildWorld();
  });

  afterAll(async () => {
    await tearDownWorld(world);
  });

  beforeEach(async () => {
    await resetTrips(world);
  });

  it('AC-EXE-01 a driver lists only her trips', async () => {
    await seedTrip(world, { tripNo: 1, stops: 6 });
    await seedTrip(world, { tripNo: 2, stops: 3 });
    await seedTrip(world, {
      vehicle: 'dry',
      driver: 'dinushi',
      tempClass: 'AMBIENT',
      tripNo: 1,
      stops: 2,
    });
    at(world, '2026-10-02T03:05:00+05:30');

    const res = await call(world, 'aniqa', 'get', '/me/trips?date=2026-10-02');
    expect(res.status).toBe(200);
    const trips = data<TripSummary[]>(res);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.tripNo).sort()).toEqual([1, 2]);
    expect(new Set(trips.map((t) => t.vehicle.code))).toEqual(
      new Set([world.vehicles.ref]),
    );
    expect(trips.some((t) => t.vehicle.code === world.vehicles.dry)).toBe(
      false,
    );
    expect(trips[0].stops).toBeGreaterThan(0);

    // D14 No trip: the same call on a day she does not drive.
    const empty = await call(
      world,
      'aniqa',
      'get',
      '/me/trips?date=2026-10-04',
    );
    expect(empty.status).toBe(200);
    expect(data<TripSummary[]>(empty)).toEqual([]);
  });

  it("AC-EXE-02 other drivers' and old trips are not found", async () => {
    const mine = await seedTrip(world, { tripNo: 1, stops: 2 });
    const hers = await seedTrip(world, {
      vehicle: 'dry',
      driver: 'dinushi',
      tempClass: 'AMBIENT',
      tripNo: 1,
      status: 'IN_PROGRESS',
      stops: 2,
    });
    const old = await seedTrip(world, {
      date: '2026-09-20',
      tripNo: 1,
      status: 'COMPLETED',
      stops: 1,
    });
    at(world, '2026-10-02T03:05:00+05:30');

    for (const tripId of [hers.tripId, old.tripId]) {
      const res = await call(
        world,
        'aniqa',
        'get',
        `/trips/${tripId}/offline-bundle`,
      );
      // The scope's own 404, not the router's: an out-of-scope trip must look
      // exactly like a missing one, with no id in the detail.
      expect(res.status).toBe(404);
      expect(expectProblem(res, 'NOT_FOUND').detail).toBe(
        'The trip was not found.',
      );
    }

    const arrive = await call(
      world,
      'aniqa',
      'post',
      `/stops/${hers.stopIds[0]}/arrive`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:12:05+05:30',
    });
    expect(arrive.status).toBe(404);
    expect(expectProblem(arrive, 'NOT_FOUND').detail).toBe(
      'The stop was not found.',
    );

    // Nothing was written for either refusal.
    expect(await eventRows(world, hers.tripId)).toHaveLength(0);
    expect(await eventRows(world, old.tripId)).toHaveLength(0);
    expect(await auditRows(world, 'execution.stop.arrived')).toHaveLength(0);
    expect(await outboxRows(world, 'stop.arrived')).toHaveLength(0);
    expect((await stopRow(world, hers.stopIds[0])).status).toBe('PENDING');

    // D10: her own trips of the last 7 days, which 20 Sep is not in.
    const recent = await call(world, 'aniqa', 'get', '/me/trips');
    expect(recent.status).toBe(200);
    const ids = data<TripSummary[]>(recent).map((t) => t.id);
    expect(ids).toContain(mine.tripId);
    expect(ids).not.toContain(old.tripId);
    expect(ids).not.toContain(hers.tripId);
  });

  it('AC-EXE-03 field writes need stop:record', async () => {
    const trip = await seedTrip(world, { tripNo: 1, stops: 2 });
    at(world, '2026-10-02T03:40:00+05:30');

    const start = await call(
      world,
      'loader',
      'post',
      `/trips/${trip.tripId}/start`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T03:40:00+05:30',
    });
    expect(start.status).toBe(403);
    expectProblem(start, 'FORBIDDEN');

    const arrive = await call(
      world,
      'dispatcher',
      'post',
      `/stops/${trip.stopIds[0]}/arrive`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T04:12:05+05:30',
    });
    expect(arrive.status).toBe(403);
    expectProblem(arrive, 'FORBIDDEN');

    expect((await tripRow(world, trip.tripId)).status).toBe('RELEASED');
    expect((await stopRow(world, trip.stopIds[0])).status).toBe('PENDING');
    expect(await eventRows(world, trip.tripId)).toHaveLength(0);
  });
});
