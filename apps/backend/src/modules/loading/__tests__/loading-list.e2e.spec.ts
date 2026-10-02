import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { orderLines, stops } from '../../../db/schema';
import type { LoadListDto } from '../dto/load-list.dto';
import { LOAD_AUDIT, LOAD_EVENTS, LOAD_LOGS } from '../loading.constants';
import {
  at,
  auditRows,
  buildWorld,
  call,
  captureLogs,
  checkEverything,
  closeWorld,
  data,
  DAY,
  deliver,
  flagRows,
  lineRows,
  outboxRows,
  publish,
  reset,
  revise,
  seedTrip,
  tripRow,
  tapUuid,
  type World,
} from './loading.world';

/**
 * The list builder: what a published plan leaves on the dock, what a revision
 * keeps, and what a reassigned vehicle undoes.
 *
 * AC-LOD-01, AC-LOD-13 and AC-LOD-19.
 */
describeWithDb('loading: the load list (ROO-33)', () => {
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => closeWorld(w));
  beforeEach(async () => {
    await reset(w);
    at(w, '2026-10-02T02:40:00+05:30');
  });

  it('AC-LOD-01 publishing builds last-stop-first lists', async () => {
    const logs = captureLogs();
    try {
      // Six stops, Fresh Kadawatha at seq 1, three lines of 12 each.
      at(w, '2026-10-01T16:42:00+05:30');
      const trip = await seedTrip(w, { stops: 6, lines: 3, qty: 12 });
      const second = await seedTrip(w, { stops: 2, tripNo: 2, vehicle: 'dry' });

      const built = await publish(w, trip, {
        tripIds: [trip.tripId, second.tripId],
      });
      expect(built.lists.map((list) => list.tripId)).toEqual([
        trip.tripId,
        second.tripId,
      ]);

      // One line per order line, all PENDING, qtyExpected from the order
      // line, stopSeq from the stop, planRevision 1.
      const lines = await lineRows(w, trip.tripId);
      expect(lines).toHaveLength(18);
      for (const line of lines) {
        expect(line.status).toBe('PENDING');
        expect(line.qtyExpected).toBe(12);
        expect(line.qtyLoaded).toBeNull();
        expect(line.planRevision).toBe(1);
        expect(line.checkedByName).toBeNull();
      }
      expect([...new Set(lines.map((line) => line.stopSeq))].sort()).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);

      // Six stop groups in the order 6, 5, 4, 3, 2, 1, so Fresh Kadawatha's
      // lines come last: the first stop's goods go in nearest the door.
      at(w, '2026-10-02T02:40:00+05:30');
      const res = await call(
        w,
        'harini',
        'get',
        `/trips/${trip.tripId}/load-list`,
      );
      expect(res.status).toBe(200);
      const list = data<LoadListDto>(res);
      expect(list.stops.map((group) => group.stopSeq)).toEqual([
        6, 5, 4, 3, 2, 1,
      ]);
      expect(list.stops.at(-1)!.outletName).toContain('Fresh Kadawatha');
      expect(list.stops.at(-1)!.lines).toHaveLength(3);
      expect(list.progress).toMatchObject({
        lines: 18,
        checked: 0,
        outstanding: 18,
        openFlags: 0,
      });
      expect(list.listRevision).toBe(1);
      expect(list.upToDate).toBe(true);

      // Every PENDING line carries check and flag, and no undo.
      for (const group of list.stops)
        for (const line of group.lines) {
          const links = line._links;
          expect(links.check).toMatchObject({ method: 'POST' });
          expect(links.flag).toMatchObject({ method: 'POST' });
          expect(links.undo).toBeUndefined();
        }

      // load.list_updated once per trip, and the log line names the trip,
      // its lines and the revision.
      const emitted = await outboxRows(w, LOAD_EVENTS.listUpdated);
      expect(emitted).toHaveLength(2);
      expect(emitted[0].payload).toMatchObject({
        v: 1,
        tripId: trip.tripId,
        revision: 1,
        lines: 18,
      });
      expect(
        await auditRows(w, LOAD_AUDIT.listBuilt, trip.tripId),
      ).toHaveLength(1);
      expect(logs.withEvent(LOAD_LOGS.listBuilt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tripId: trip.tripId,
            lines: 18,
            revision: 1,
          }),
        ]),
      );

      // The relay delivers the same event again: nothing is added or
      // changed, and load.list_updated is not emitted again.
      const again = await deliver(w, {
        id: built.eventId,
        type: 'plan.published',
        payload: {
          v: 1,
          planId: trip.planId,
          revision: 1,
          tripIds: [trip.tripId, second.tripId],
        },
      });
      expect(again.replayed).toBe(true);
      expect(again.lists).toEqual([]);
      expect(await lineRows(w, trip.tripId)).toHaveLength(18);
      expect(await outboxRows(w, LOAD_EVENTS.listUpdated)).toHaveLength(2);
      expect(
        await auditRows(w, LOAD_AUDIT.listBuilt, trip.tripId),
      ).toHaveLength(1);
    } finally {
      logs.restore();
    }
  });

  it('AC-LOD-13 a revision keeps unchanged checks', async () => {
    const trip = await seedTrip(w, { stops: 6, lines: 1, qty: 12 });
    await publish(w, trip);

    // Stops 6 and 5 are checked OK; the rest stay PENDING.
    const before = await lineRows(w, trip.tripId);
    const checked = before.filter((line) => line.stopSeq >= 5);
    expect(checked).toHaveLength(2);
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: checked.map((line, i) => ({
          lineId: line.id,
          qtyLoaded: 12,
          checkedByName: 'Harini De Mel',
          clientUuid: tapUuid(w, i + 1),
          checkedAt: '2026-10-02T02:45:10+05:30',
        })),
      },
    );
    expect(res.status).toBe(200);

    // A revision moves the order at stop 3 to another trip.
    const movedStop = before.find((line) => line.stopSeq === 3)!;
    // A stop is soft-cancelled, never deleted, so offline clients learn it
    // went away (src/db/schema/planning.ts).
    await w.db
      .update(stops)
      .set({ status: 'CANCELLED', seq: null, cancelledReason: 'MOVED' })
      .where(eq(stops.orderId, movedStop.orderId));
    const revised = await revise(w, trip, { reasonCode: 'TRIP_FULL' });
    expect(revised.lists[0]).toMatchObject({
      tripId: trip.tripId,
      revision: 2,
      removed: 1,
      keptChecks: 2,
    });

    const after = await lineRows(w, trip.tripId);
    // Stops 6 and 5 keep status, quantity and the name that checked them.
    for (const line of after.filter((l) => l.stopSeq >= 5)) {
      expect(line.status).toBe('OK');
      expect(line.qtyLoaded).toBe(12);
      expect(line.checkedByName).toBe('Harini De Mel');
    }
    // The moved order's line is marked removed and no longer counts.
    const moved = after.find((line) => line.id === movedStop.id)!;
    expect(moved.status).toBe('REMOVED');
    // Every line on the trip carries planRevision 2.
    expect(after.map((line) => line.planRevision)).toEqual(after.map(() => 2));
    expect(await outboxRows(w, LOAD_EVENTS.listUpdated)).toHaveLength(2);

    // The tablet is told what changed, so L2 can show the Plan updated
    // banner: the list is at 2, and the removed line is not outstanding.
    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    expect(list.listRevision).toBe(2);
    expect(list.upToDate).toBe(true);
    expect(list.progress).toMatchObject({
      lines: 6,
      checked: 3,
      outstanding: 3,
    });
    expect(list.stops.map((group) => group.stopSeq)).toEqual([
      6, 5, 4, 3, 2, 1,
    ]);
  });

  it('AC-LOD-19 a moved released trip loads again', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 12 });
    await publish(w, trip);
    expect((await checkEverything(w, trip.tripId)).status).toBe(200);
    const released = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 90),
      },
    );
    expect(released.status).toBe(200);
    expect((await tripRow(w, trip.tripId)).status).toBe('RELEASED');

    // Tihara reassigns it to another vehicle.
    const reassigned = await deliver(w, {
      type: 'trip.reassigned',
      payload: {
        v: 1,
        tripId: trip.tripId,
        vehicleId: w.vehicles.dry,
        vehicleChanged: true,
        reasonCode: 'BREAKDOWN',
      },
    });
    expect(reassigned.lists[0]).toMatchObject({
      tripId: trip.tripId,
      reopened: true,
    });

    // The trip is LOADING again and its release is gone, so it has to pass
    // its checks and be released a second time.
    const after = await tripRow(w, trip.tripId);
    expect(after.status).toBe('LOADING');
    expect(after.releasedAt).toBeNull();
    expect(after.releaseTempC).toBeNull();
    expect(
      (await outboxRows(w, LOAD_EVENTS.listUpdated)).at(-1)!.payload,
    ).toMatchObject({ reopened: true });

    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    expect(list._links.release).toMatchObject({ method: 'POST' });
    const again = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 4.1,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 91),
      },
    );
    expect(again.status).toBe(200);
    expect((await tripRow(w, trip.tripId)).status).toBe('RELEASED');
  });

  it('keeps a driver-only reassign out of the dock’s way', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1 });
    await publish(w, trip);
    await checkEverything(w, trip.tripId);
    await call(w, 'harini', 'post', `/trips/${trip.tripId}/release`, {
      reeferTempC: 3.4,
      checkedByName: 'Harini De Mel',
      clientUuid: tapUuid(w, 92),
    });

    const handled = await deliver(w, {
      type: 'trip.reassigned',
      payload: {
        v: 1,
        tripId: trip.tripId,
        driverId: w.as.driver.id,
        vehicleChanged: false,
      },
    });
    expect(handled.lists).toEqual([]);
    expect((await tripRow(w, trip.tripId)).status).toBe('RELEASED');
  });

  it('builds one line for an order that carries none', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 7 });
    // An older order with its units on the order row and no lines at all.
    await w.db
      .delete(orderLines)
      .where(eq(orderLines.orderId, trip.orderIds[0]));
    await publish(w, trip);
    const lines = await lineRows(w, trip.tripId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ orderLineId: null, qtyExpected: 7 });
  });

  it('drops a payload it cannot read, and keeps the receipt', async () => {
    const logs = captureLogs();
    try {
      const trip = await seedTrip(w, { stops: 1 });
      const handled = await deliver(w, {
        type: 'plan.published',
        payload: { v: 1, planId: trip.planId }, // no revision, no tripIds
      });
      expect(handled.lists).toEqual([]);
      expect(await lineRows(w, trip.tripId)).toEqual([]);
      expect(logs.withEvent(LOAD_LOGS.eventUnreadable)).toHaveLength(1);
    } finally {
      logs.restore();
    }
  });

  it('ignores an event about a cancelled trip', async () => {
    const trip = await seedTrip(w, { stops: 1, status: 'CANCELLED' });
    const handled = await publish(w, trip);
    expect(handled.lists).toEqual([]);
    expect(await lineRows(w, trip.tripId)).toEqual([]);
    expect(await flagRows(w, trip.tripId)).toEqual([]);
  });

  it(`puts the day's trips on the runs board even without a wave`, async () => {
    const waved = await seedTrip(w, { stops: 1, wave: 'run1' });
    await seedTrip(w, {
      stops: 1,
      wave: null,
      tripNo: 2,
      vehicle: 'dry',
      date: DAY,
    });
    await publish(w, waved, { tripIds: [waved.tripId] });

    const runs = data<{ waveId: string | null; label: string }[]>(
      await call(
        w,
        'harini',
        'get',
        `/depots/${w.depot.plg}/loading/runs?date=${DAY}`,
      ),
    );
    expect(runs.map((run) => run.waveId)).toEqual([w.waves.run1, null]);
    expect(runs.at(-1)!.label).toBe('No wave');
  });
});
