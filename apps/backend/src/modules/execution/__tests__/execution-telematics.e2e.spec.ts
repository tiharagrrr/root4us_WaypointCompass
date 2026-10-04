import { and, asc, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import {
  EVENTS_CHANNEL,
  type DeliveredEvent,
} from '../../../core/outbox/event-bus';
import { OutboxRelay } from '../../../core/outbox/outbox-relay.service';
import {
  alerts,
  outboxEvents,
  positionPings,
  trips,
  vehiclePositions,
} from '../../../db/schema';
import { KEEP_EVERY_M, KEEP_EVERY_MS, metresBetween } from '../domain/pings';
import { SignalWatchService } from '../services/signal-watch.service';
import {
  at,
  buildWorld,
  call,
  data,
  outboxRows,
  resetTrips,
  seedTrip,
  tearDownWorld,
  type World,
} from './execution.world';

const itWithRedis = process.env.TEST_REDIS_URL ? it : it.skip;

/** "2026-10-02T04:08:00" on the Colombo clock, plus `seconds`. */
const colombo = (hms: string, seconds = 0) =>
  new Date(new Date(`2026-10-02T${hms}+05:30`).getTime() + seconds * 1000);

/** A fix near Kadawatha, `step` × 50 m further north for each ping. */
const ping = (tripId: string, recordedAt: Date, step = 0, extra = {}) => ({
  tripId,
  lat: 7.0014 + step * 0.00045,
  lng: 79.9507,
  accuracyM: 12,
  speedKmh: 30,
  heading: 0,
  recordedAt: recordedAt.toISOString(),
  ...extra,
});

interface PingResult {
  accepted: number;
  duplicates: number;
  rejected: number;
}

/**
 * POST /telematics/pings and the signal watch (specs/execution/spec.md, Ping
 * pipeline, AC-EXE-17 to 19): counted and deduplicated, invalid fixes refused,
 * positions to the screens at most every 5 seconds and never through the
 * outbox, and a silent trip announced offline exactly once.
 */
describeWithDb('execution: telematics', () => {
  jest.setTimeout(60_000);
  let world: World;

  beforeAll(async () => {
    world = await buildWorld();
  });
  afterAll(async () => {
    await resetTrips(world);
    await tearDownWorld(world);
  });
  beforeEach(async () => {
    await resetTrips(world);
  });

  const send = (role: 'aniqa' | 'dinushi', pings: unknown[]) =>
    call(world, role, 'post', '/telematics/pings').send({ pings });

  const running = async (
    role: 'aniqa' | 'dinushi' = 'aniqa',
    vehicle: 'ref' | 'dry' = 'ref',
  ) => {
    const trip = await seedTrip(world, {
      driver: role,
      vehicle,
      status: 'IN_PROGRESS',
    });
    await world.db
      .update(trips)
      .set({ startedAt: colombo('04:00:00') })
      .where(eq(trips.id, trip.tripId));
    return trip;
  };

  itWithRedis('AC-EXE-17 Pings are counted and deduplicated', async () => {
    at(world, '2026-10-02T04:12:30+05:30');
    const { tripId, vehicleId } = await running();
    const series = Array.from({ length: 20 }, (_, i) =>
      ping(tripId, colombo('04:08:00', i * 13), i),
    );

    // Watch what reaches the screens.
    const sub = new Redis(process.env.TEST_REDIS_URL!);
    const seen: DeliveredEvent[] = [];
    await sub.subscribe(EVENTS_CHANNEL);
    sub.on('message', (_c, m: string) => {
      const e = JSON.parse(m) as DeliveredEvent;
      if (e.type === 'vehicle.position' && e.aggregateId === vehicleId)
        seen.push(e);
    });

    try {
      const first = await send('aniqa', [series[0], series[3]]).expect(200);
      expect(data<PingResult>(first)).toMatchObject({
        accepted: 2,
        duplicates: 0,
        rejected: 0,
      });

      const res = await send('aniqa', series).expect(200);
      expect(data<PingResult>(res)).toMatchObject({
        accepted: 18,
        duplicates: 2,
        rejected: 0,
      });

      const [position] = await world.db
        .select()
        .from(vehiclePositions)
        .where(eq(vehiclePositions.vehicleId, vehicleId));
      expect(position.recordedAt).toEqual(colombo('04:08:00', 19 * 13));

      // An older fix arriving late never moves the vehicle back.
      await send('aniqa', [ping(tripId, colombo('04:10:00'), 5)]).expect(200);
      const [still] = await world.db
        .select()
        .from(vehiclePositions)
        .where(eq(vehiclePositions.vehicleId, vehicleId));
      expect(still.recordedAt).toEqual(colombo('04:08:00', 19 * 13));

      // The trail keeps a fix every 30 seconds or 100 m.
      const trail = await world.db
        .select()
        .from(positionPings)
        .where(eq(positionPings.vehicleId, vehicleId))
        .orderBy(asc(positionPings.recordedAt));
      expect(trail.length).toBeLessThan(21);
      for (let i = 1; i < trail.length; i += 1) {
        const gap =
          trail[i].recordedAt.getTime() - trail[i - 1].recordedAt.getTime();
        expect(
          gap >= KEEP_EVERY_MS ||
            metresBetween(trail[i - 1], trail[i]) >= KEEP_EVERY_M,
        ).toBe(true);
      }

      // Three batches inside 5 seconds: one position on the wire, and none in the outbox.
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toHaveLength(1);
      expect(seen[0].id).toBe(
        `${vehicleId}:${colombo('04:08:00', 3 * 13).toISOString()}`,
      );
      const outboxed = await world.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.type, 'vehicle.position'));
      expect(outboxed).toEqual([]);
    } finally {
      sub.disconnect();
    }
  });

  it('AC-EXE-18 Invalid pings are rejected', async () => {
    at(world, '2026-10-02T04:12:00+05:30');
    const { tripId } = await running();
    const released = await seedTrip(world, { tripNo: 2, status: 'RELEASED' });

    const res = await send('aniqa', [
      ping(tripId, colombo('04:11:00'), 0, { lat: 51.5, lng: -0.12 }),
      ping(tripId, colombo('04:11:10'), 0, { accuracyM: 250 }),
      ping(tripId, colombo('04:15:00')),
      ping(tripId, new Date('2026-10-01T04:00:00+05:30')),
      ping(released.tripId, colombo('04:11:20')),
    ]).expect(200);
    expect(data<PingResult>(res)).toMatchObject({
      accepted: 0,
      duplicates: 0,
      rejected: 5,
    });
    expect(
      await world.db
        .select()
        .from(positionPings)
        .where(eq(positionPings.tripId, tripId)),
    ).toEqual([]);

    const tooMany = Array.from({ length: 201 }, (_, i) =>
      ping(tripId, colombo('04:00:00', i)),
    );
    expectProblem(await send('aniqa', tooMany), 'PAYLOAD_TOO_LARGE');

    // Dinushi does not drive REF-07 today.
    const hers = await send('dinushi', [
      ping(tripId, colombo('04:11:30')),
    ]).expect(200);
    expect(data<PingResult>(hers)).toMatchObject({ accepted: 0, rejected: 1 });
  });

  it('AC-EXE-19 Silence raises VEHICLE_OFFLINE until the next ping', async () => {
    at(world, '2026-10-02T04:30:30+05:30');
    const { tripId } = await running();
    await send('aniqa', [ping(tripId, colombo('04:30:00'))]).expect(200);

    const watch = (hms: string) =>
      world.app
        .get(JobContextRunner)
        .run({ id: `test:signal:${hms}` }, () =>
          world.app.get(SignalWatchService).watch(colombo(hms), [tripId]),
        );
    const relay = (type: string) =>
      world.app.get(OutboxRelay).drain({ types: [type] });
    const offlineAlert = () =>
      world.db
        .select()
        .from(alerts)
        .where(
          and(eq(alerts.type, 'VEHICLE_OFFLINE'), eq(alerts.tripId, tripId)),
        );

    expect(await watch('04:59:00')).toBe(0);
    expect(await watch('05:01:00')).toBe(1);
    expect(await watch('05:02:00')).toBe(0);
    const offline = await outboxRows(world, 'vehicle.offline', tripId);
    expect(offline).toHaveLength(1);
    expect(offline[0].payload).toMatchObject({ tripId, minutesSilent: 31 });

    await relay('vehicle.offline');
    const [raised] = await offlineAlert();
    expect(raised).toMatchObject({ status: 'OPEN' });

    at(world, '2026-10-02T05:05:30+05:30');
    await send('aniqa', [ping(tripId, colombo('05:05:00'))]).expect(200);
    await send('aniqa', [ping(tripId, colombo('05:05:20'), 1)]).expect(200);
    expect(await outboxRows(world, 'vehicle.back_online', tripId)).toHaveLength(
      1,
    );
    await relay('vehicle.back_online');
    const [resolved] = await offlineAlert();
    expect(resolved).toMatchObject({ status: 'RESOLVED' });
  });

  it('AC-EXE-23 The dispatcher tracks running trips', async () => {
    at(world, '2026-10-02T04:30:30+05:30');
    const { tripId } = await running();
    await send('aniqa', [ping(tripId, colombo('04:30:00'))]).expect(200);

    at(world, '2026-10-02T04:41:00+05:30');
    const day = await call(
      world,
      'dispatcher',
      'get',
      `/depots/${world.depot.plg}/tracking?date=2026-10-02`,
    ).expect(200);
    type Trip = {
      tripId: string;
      position: { lat: number; lng: number; recordedAt: string } | null;
      lastSignalAt: string | null;
      noSignalSince: string | null;
      stops: { at: { lat: number; lng: number } | null }[];
    };
    const trip = data<{ trips: Trip[] }>(day).trips.find(
      (t) => t.tripId === tripId,
    )!;
    expect(trip.position).toMatchObject({ lat: 7.0014, lng: 79.9507 });
    expect(trip.lastSignalAt).toMatch(/T04:30:00/);
    // Eleven minutes of silence: 19 shows "No signal since 04:30".
    expect(trip.noSignalSince).toMatch(/T04:30:00/);
    expect(trip.stops[0].at).toEqual({ lat: 7.0014, lng: 79.9507 });

    const trail = await call(
      world,
      'dispatcher',
      'get',
      `/trips/${tripId}/trail`,
    ).expect(200);
    expect(data<{ points: unknown[] }>(trail).points).toHaveLength(1);

    // The driver has no map of the depot's day.
    await call(world, 'aniqa', 'get', `/trips/${tripId}/trail`).expect(403);
    await call(
      world,
      'aniqa',
      'get',
      `/depots/${world.depot.plg}/tracking`,
    ).expect(403);
  });
});
