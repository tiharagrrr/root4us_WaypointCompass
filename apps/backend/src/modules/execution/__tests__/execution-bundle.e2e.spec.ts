import { describeWithDb } from '../../../../test/create-test-app';
import type { OfflineBundle } from '../services/offline-bundle.service';
import {
  at,
  auditRows,
  buildWorld,
  call,
  cancelStop,
  data,
  eventRows,
  outboxRows,
  resequence,
  resetTrips,
  seedTrip,
  tearDownWorld,
  tripRow,
  type World,
} from './execution.world';

describeWithDb('execution: the offline bundle (D1, D2, D9)', () => {
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

  it('AC-EXE-04 the offline bundle is versioned and hashed', async () => {
    const trip = await seedTrip(world, { tripNo: 1, stops: 6, qty: 10 });
    at(world, '2026-10-02T03:05:00+05:30');

    const res = await call(
      world,
      'aniqa',
      'get',
      `/trips/${trip.tripId}/offline-bundle`,
    );
    expect(res.status).toBe(200);
    const bundle = data<OfflineBundle>(res);

    expect(bundle.trip.id).toBe(trip.tripId);
    expect(bundle.trip.date).toBe('2026-10-02');
    expect(bundle.stops).toHaveLength(6);
    expect(bundle.stops.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);

    // Each outlet with its window, and what D9 Dock and access needs offline.
    const first = bundle.stops[0];
    expect(first.outlet.id).toBe(world.kadawatha);
    expect(first.window).toMatchObject({
      openMin: 420,
      open: '07:00',
      closeMin: 540,
      close: '09:00',
    });
    expect(first.outlet.accessNotes).toBe(
      'Gate 2 after 06:00; reverse in from the lane',
    );
    expect(first.outlet.contactName).toBe('K. Fernando');
    expect(first.outlet.contactPhone).toBe('+94 71 234 5678');
    expect(first.outlet.dockType).toBe('REAR_DOCK');

    // The order lines to deliver.
    expect(first.order.lines).toHaveLength(1);
    expect(first.order.lines[0]).toMatchObject({ qty: 10 });
    expect(first.order.lines[0].sku).toBeTruthy();

    // A version and a hash, both stable while nothing changes.
    expect(bundle.version).toBe(1);
    expect(bundle.hash).toMatch(/^[0-9a-f]{64}$/);
    const again = await call(
      world,
      'aniqa',
      'get',
      `/trips/${trip.tripId}/offline-bundle`,
    );
    const second = data<OfflineBundle>(again);
    expect(second.version).toBe(bundle.version);
    expect(second.hash).toBe(bundle.hash);

    // About 50 KB is the budget for a whole run.
    expect(JSON.stringify(bundle).length).toBeLessThan(50 * 1024);

    // Confirming the download records which bundle the phone holds.
    const confirmed = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/downloaded`,
    ).send({
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T03:05:30+05:30',
      bundleVersion: bundle.version,
      bundleHash: bundle.hash,
    });
    expect(confirmed.status).toBe(200);

    const row = await tripRow(world, trip.tripId);
    expect(row.downloadedAt).toEqual(new Date('2026-10-02T03:05:30+05:30'));

    const events = await eventRows(world, trip.tripId, 'TRIP_DOWNLOADED');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      bundleVersion: bundle.version,
      bundleHash: bundle.hash,
    });
    expect(events[0].lateSync).toBe(false);
    expect(
      await auditRows(world, 'execution.trip.downloaded', trip.tripId),
    ).toHaveLength(1);
    expect(
      await outboxRows(world, 'trip.downloaded', trip.tripId),
    ).toHaveLength(1);
  });

  /**
   * The issue's "consumes plan.revised, trip.reassigned, trip.resequenced,
   * stop.deferred" needs no handler in execution: the hash is computed from
   * the bundle on every read, so anything planning changes shows up as a new
   * hash by itself. The push that tells the phone to look is notifications'
   * (ROO-24 relays the events), and the changes feed is ROO-44's.
   */
  it("AC-EXE-04 a revision changes the bundle's hash, with nothing subscribed", async () => {
    const trip = await seedTrip(world, { tripNo: 1, stops: 3 });
    at(world, '2026-10-02T03:05:00+05:30');
    const before = data<OfflineBundle>(
      await call(world, 'aniqa', 'get', `/trips/${trip.tripId}/offline-bundle`),
    );

    // Re-sequenced, as 19b would: the same stops in a new order.
    await resequence(world, [
      trip.stopIds[2],
      trip.stopIds[0],
      trip.stopIds[1],
    ]);
    const resequenced = data<OfflineBundle>(
      await call(world, 'aniqa', 'get', `/trips/${trip.tripId}/offline-bundle`),
    );
    expect(resequenced.hash).not.toBe(before.hash);
    expect(resequenced.stops.map((stop) => stop.id)).toEqual([
      trip.stopIds[2],
      trip.stopIds[0],
      trip.stopIds[1],
    ]);

    // Deferred mid-route, as 19a would: the stop leaves the run.
    await cancelStop(world, trip.stopIds[1]);
    const deferred = data<OfflineBundle>(
      await call(world, 'aniqa', 'get', `/trips/${trip.tripId}/offline-bundle`),
    );
    expect(deferred.stops).toHaveLength(2);
    expect(deferred.stops.map((stop) => stop.id)).not.toContain(
      trip.stopIds[1],
    );
    expect(deferred.hash).not.toBe(resequenced.hash);
  });

  it('AC-EXE-04 a second download of the same bundle is recorded once', async () => {
    const trip = await seedTrip(world, { tripNo: 1, stops: 2 });
    at(world, '2026-10-02T03:05:00+05:30');
    const body = {
      clientUuid: crypto.randomUUID(),
      occurredAt: '2026-10-02T03:05:30+05:30',
      bundleVersion: 1,
      bundleHash: 'a'.repeat(64),
    };

    const first = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/downloaded`,
    ).send(body);
    const replay = await call(
      world,
      'aniqa',
      'post',
      `/trips/${trip.tripId}/downloaded`,
    ).send(body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    // The phone lost the first answer and sent the same tap again.
    expect(await eventRows(world, trip.tripId, 'TRIP_DOWNLOADED')).toHaveLength(
      1,
    );
    expect(
      await auditRows(world, 'execution.trip.downloaded', trip.tripId),
    ).toHaveLength(1);
  });
});
