import type { ReleaseCheck, ReleaseCheckId } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { settings } from '../../../db/schema';
import { LOADER_EVENT_TYPES } from '../domain/loader-event';
import type {
  LoadFlagDto,
  LoadListDto,
  ReleaseChecksDto,
} from '../dto/load-list.dto';
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
  lineRow,
  lineRows,
  orderRow,
  outboxRows,
  publish,
  releaseRow,
  reset,
  seedTrip,
  tapUuid,
  tripRow,
  type World,
} from './loading.world';

/**
 * Release: the preconditions, the reefer reading, what leaving the dock does
 * to the trip and its orders, and why there is no offline path.
 * AC-LOD-14 to AC-LOD-17.
 */
describeWithDb('loading: release (ROO-33)', () => {
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(async () => {
    await w.db
      .delete(settings)
      .where(eq(settings.key, 'loading.maxReleaseTempC'));
    await closeWorld(w);
  });
  beforeEach(async () => {
    await reset(w);
    at(w, '2026-10-02T03:20:00+05:30');
  });

  /** A trip whose every line is checked: one tap from leaving the dock. */
  async function aReadyTrip(input: { stops?: number; driver?: null } = {}) {
    const trip = await seedTrip(w, {
      stops: input.stops ?? 6,
      lines: 1,
      qty: 12,
      ...(input.driver === null ? { driver: null } : {}),
    });
    await publish(w, trip);
    await checkEverything(w, trip.tripId, 400);
    return trip;
  }

  const failing = (checks: readonly ReleaseCheck[]): ReleaseCheckId[] =>
    checks.filter((check) => !check.pass).map((check) => check.id);

  it('AC-LOD-14 release is refused while a check fails', async () => {
    const trip = await seedTrip(w, { stops: 6, lines: 1, qty: 12 });
    await publish(w, trip);
    const lines = await lineRows(w, trip.tripId);
    // Every line OK except one, which carries an open flag.
    const flagged = lines[0];
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: lines.slice(1).map((line, index) => ({
          lineId: line.id,
          qtyLoaded: 12,
          checkedByName: 'Harini De Mel',
          clientUuid: tapUuid(w, 410 + index),
          checkedAt: '2026-10-02T02:45:10+05:30',
        })),
      },
    );
    expect(res.status).toBe(200);
    const flag = data<LoadFlagDto>(
      await call(w, 'harini', 'post', `/trips/${trip.tripId}/load-flags`, {
        loadLineId: flagged.id,
        reason: 'MISSING',
        qtyAffected: 2,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 419),
      }),
    );
    expect(flag.status).toBe('OPEN');

    // The checklist: a pass or a fail for each precondition, with the line
    // check and the open-flag check failing. L4 passes the reading the
    // loader has typed so far, so the list shows live rather than failing
    // the temperature check for a thermometer nobody has read yet.
    const checks = await call(
      w,
      'harini',
      'get',
      `/trips/${trip.tripId}/release-checks?reeferTempC=3.4`,
    );
    expect(checks.status).toBe(200);
    const body = data<ReleaseChecksDto>(checks);
    expect(body.canRelease).toBe(false);
    expect(body.checks).toHaveLength(6);
    expect(failing(body.checks)).toEqual(['LINES_RESOLVED', 'NO_OPEN_FLAG']);
    expect(body.maxReleaseTempC).toBe(5);

    // Releasing it anyway: 409 listing the failing checks.
    const refused = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 420),
      },
    );
    expect(refused.status).toBe(409);
    const problem = expectProblem(refused, 'CONFLICT_STATE');
    expect(problem.failedChecks).toEqual(['LINES_RESOLVED', 'NO_OPEN_FLAG']);
    expect(problem.checks as ReleaseCheck[]).toHaveLength(6);

    // The trip stays LOADING, its orders keep their status, and nothing was
    // audited or emitted.
    expect((await tripRow(w, trip.tripId)).status).toBe('LOADING');
    for (const orderId of trip.orderIds)
      expect((await orderRow(w, orderId)).status).toBe('PLANNED');
    expect(await auditRows(w, LOAD_AUDIT.tripReleased)).toHaveLength(0);
    expect(await outboxRows(w, LOAD_EVENTS.tripReleased)).toHaveLength(0);
    expect(await releaseRow(w, trip.tripId)).toBeUndefined();

    // Another trip with every line resolved but no driver: the driver check
    // is what fails.
    const driverless = await aReadyTrip({ stops: 1, driver: null });
    const noDriver = await call(
      w,
      'harini',
      'post',
      `/trips/${driverless.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 421),
      },
    );
    expect(noDriver.status).toBe(409);
    expect(expectProblem(noDriver, 'CONFLICT_STATE').failedChecks).toEqual([
      'DRIVER_ASSIGNED',
    ]);
  });

  it('AC-LOD-15 chilled trips need a cold reefer', async () => {
    const trip = await aReadyTrip({ stops: 1 });
    expect((await tripRow(w, trip.tripId)).tempClass).toBe('CHILLED');

    // No reading at all.
    const none = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 430),
      },
    );
    expect(none.status).toBe(409);
    expect(expectProblem(none, 'CONFLICT_STATE').failedChecks).toEqual([
      'REEFER_TEMP',
    ]);
    expect((await tripRow(w, trip.tripId)).status).toBe('LOADING');

    // A tenth of a degree over the 5.0 limit.
    const warm = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 5.1,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 431),
      },
    );
    expect(warm.status).toBe(409);
    expect(expectProblem(warm, 'CONFLICT_STATE').failedChecks).toEqual([
      'REEFER_TEMP',
    ]);
    expect((await tripRow(w, trip.tripId)).status).toBe('LOADING');

    // Exactly the limit releases.
    const ok = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 5.0,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 432),
      },
    );
    expect(ok.status).toBe(200);
    const after = await tripRow(w, trip.tripId);
    expect(after.status).toBe('RELEASED');
    expect(after.releaseTempC).toBe(5);
  });

  it('AC-LOD-16 release the trip', async () => {
    const logs = captureLogs();
    try {
      const trip = await aReadyTrip({ stops: 6 });
      // One line replaced and one removed, so the criterion's "OK, REPLACED
      // or REMOVED" is what is actually released.
      const lines = await lineRows(w, trip.tripId);
      await makeReplaced(w, trip.tripId, lines[0].id, 440);

      const res = await call(
        w,
        'harini',
        'post',
        `/trips/${trip.tripId}/release`,
        {
          reeferTempC: 3.4,
          checkedByName: 'Harini De Mel',
          clientUuid: tapUuid(w, 450),
        },
      );
      expect(res.status).toBe(200);
      const list = data<LoadListDto>(res);
      expect(list.trip.status).toBe('RELEASED');
      expect(list.trip.releasedAt).toBe('2026-10-02T03:20:00+05:30');
      expect(list.trip.releaseTempC).toBe(3.4);
      expect(list.releasedByName).toBe('Harini De Mel');

      const after = await tripRow(w, trip.tripId);
      expect(after.releasedById).toBe(w.as.harini.id);
      expect(after.releasedAt?.toISOString()).toBe(
        new Date('2026-10-02T03:20:00+05:30').toISOString(),
      );
      // The typed Checked-by name, which `trips` has no room for.
      expect(await releaseRow(w, trip.tripId)).toMatchObject({
        checkedByName: 'Harini De Mel',
        releaseTempC: 3.4,
        planRevision: 1,
        clientUuid: tapUuid(w, 450),
      });

      // Every order on the trip is LOADED, through OrderLifecycleService.
      for (const orderId of trip.orderIds)
        expect((await orderRow(w, orderId)).status).toBe('LOADED');

      // Exactly one audit row and one trip.released event.
      const rows = await auditRows(w, LOAD_AUDIT.tripReleased, trip.tripId);
      expect(rows).toHaveLength(1);
      expect(rows[0].actorName).toBe('Harini De Mel');
      const emitted = await outboxRows(
        w,
        LOAD_EVENTS.tripReleased,
        trip.tripId,
      );
      expect(emitted).toHaveLength(1);
      // What the driver's push and SMS are built from.
      expect(emitted[0].payload).toMatchObject({
        v: 1,
        tripId: trip.tripId,
        driverId: w.as.driver.id,
        stops: 6,
        releaseTempC: 3.4,
        firstStopAt: '2026-10-02T04:10:00+05:30',
      });

      // The log line carries the temperature and the minutes from the first
      // check to the release.
      expect(logs.withEvent(LOAD_LOGS.tripReleased)).toEqual([
        expect.objectContaining({
          tripId: trip.tripId,
          releaseTempC: 3.4,
          loadingMinutes: 35,
        }),
      ]);

      // Nothing is left to press: no release on the trip, and no check,
      // flag, undo or recheck on any line or flag.
      expect(list._links.release).toBeUndefined();
      for (const group of list.stops)
        for (const line of group.lines) {
          const links = line._links;
          expect(links.check).toBeUndefined();
          expect(links.flag).toBeUndefined();
          expect(links.undo).toBeUndefined();
          for (const flag of line.flags) {
            const own = flag._links;
            expect(own.undo).toBeUndefined();
            expect(own.decide).toBeUndefined();
            expect(own.recheck).toBeUndefined();
          }
        }

      // The same release again, with the same clientUuid: no second audit
      // row, no second event, and releasedAt stays where it was.
      const again = await call(
        w,
        'harini',
        'post',
        `/trips/${trip.tripId}/release`,
        {
          reeferTempC: 3.4,
          checkedByName: 'Harini De Mel',
          clientUuid: tapUuid(w, 450),
        },
      );
      expect(again.status).toBe(200);
      expect(
        await auditRows(w, LOAD_AUDIT.tripReleased, trip.tripId),
      ).toHaveLength(1);
      expect(
        await outboxRows(w, LOAD_EVENTS.tripReleased, trip.tripId),
      ).toHaveLength(1);
      expect((await tripRow(w, trip.tripId)).releasedAt?.toISOString()).toBe(
        new Date('2026-10-02T03:20:00+05:30').toISOString(),
      );
    } finally {
      logs.restore();
    }
  });

  it('AC-LOD-17 release needs a connection', async () => {
    // The offline half of this criterion is L4's: the tablet shows its
    // needs-a-connection state and queues nothing (specs/loading/spec.md,
    // Services and helpers). What the API owes it is that release is not a
    // loader event at all, so there is no outbox type that could carry one.
    expect(LOADER_EVENT_TYPES).not.toContain('LOAD_RELEASED');
    for (const type of LOADER_EVENT_TYPES) expect(type).not.toMatch(/RELEASE/);

    // And the release link says what the request must carry, so the screen
    // can tell a loader what it needs before they are offline.
    const trip = await aReadyTrip({ stops: 1 });
    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    expect(list._links.release).toMatchObject({
      href: `/api/v1/trips/${trip.tripId}/release`,
      method: 'POST',
      requires: ['reeferTempC', 'checkedByName', 'clientUuid'],
    });
  });

  it('fails the revision check when the tablet has not seen the latest plan', async () => {
    const trip = await aReadyTrip({ stops: 1 });
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 460),
        planRevision: 0,
      },
    );
    expect(res.status).toBe(409);
    expect(expectProblem(res, 'CONFLICT_STATE').failedChecks).toEqual([
      'LATEST_REVISION',
    ]);
    expect((await tripRow(w, trip.tripId)).status).toBe('LOADING');
  });

  it('reads the temperature limit from the setting, not a constant', async () => {
    // The key is global, not per depot: the cold chain is a food-safety
    // limit rather than a depot's preference, so A6 sets one number.
    await w.db.insert(settings).values({
      key: 'loading.maxReleaseTempC',
      scope: 'global',
      value: 2,
      updatedById: w.as.admin.id,
    });
    const trip = await aReadyTrip({ stops: 1 });
    const checks = data<ReleaseChecksDto>(
      await call(
        w,
        'harini',
        'get',
        `/trips/${trip.tripId}/release-checks?reeferTempC=3.4`,
      ),
    );
    expect(checks.maxReleaseTempC).toBe(2);
    expect(failing(checks.checks)).toEqual(['REEFER_TEMP']);
    await w.db
      .delete(settings)
      .where(eq(settings.key, 'loading.maxReleaseTempC'));
  });

  it('releases an ambient trip with no reading at all', async () => {
    const trip = await seedTrip(w, {
      stops: 1,
      lines: 1,
      vehicle: 'dry',
      tempClass: 'AMBIENT',
    });
    await publish(w, trip);
    await checkEverything(w, trip.tripId, 470);
    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    expect(list._links.release).toMatchObject({
      requires: ['checkedByName', 'clientUuid'],
    });
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 471),
      },
    );
    expect(res.status).toBe(200);
    expect(await releaseRow(w, trip.tripId)).toMatchObject({
      releaseTempC: null,
    });
  });

  it('leaves an order behind whose every line was removed', async () => {
    const trip = await seedTrip(w, { stops: 2, lines: 1, qty: 12 });
    await publish(w, trip);
    const lines = await lineRows(w, trip.tripId);
    const removed = lines[0];
    const flag = data<LoadFlagDto>(
      await call(w, 'harini', 'post', `/trips/${trip.tripId}/load-flags`, {
        loadLineId: removed.id,
        reason: 'DAMAGED',
        qtyAffected: 12,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 480),
      }),
    );
    await call(w, 'tihara', 'post', `/load-flags/${flag.id}/decision`, {
      decision: 'REMOVE',
      reasonCode: w.reasons.damaged,
      note: 'Whole pallet crushed',
    });
    expect(await lineRow(w, removed.id)).toMatchObject({
      status: 'REMOVED',
      qtyLoaded: 0,
    });
    await checkEverything(w, trip.tripId, 481);

    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 490),
      },
    );
    expect(res.status).toBe(200);
    // The order whose goods all stayed behind is not on the vehicle.
    expect((await orderRow(w, removed.orderId)).status).toBe('PLANNED');
    const travelled = trip.orderIds.find((id) => id !== removed.orderId)!;
    expect((await orderRow(w, travelled)).status).toBe('LOADED');
  });
});

/** Takes a line through flag → REPLACE → re-check, so it ends REPLACED. */
async function makeReplaced(
  world: World,
  tripId: string,
  lineId: string,
  n: number,
): Promise<void> {
  const before = await lineRow(world, lineId);
  // Undo the check first: a flag belongs on goods the loader is still
  // dealing with, and this line is already OK.
  await call(world, 'harini', 'post', `/load-lines/${lineId}/undo`);
  const flag = data<LoadFlagDto>(
    await call(world, 'harini', 'post', `/trips/${tripId}/load-flags`, {
      loadLineId: lineId,
      reason: 'DAMAGED',
      qtyAffected: 2,
      raisedByName: 'Harini De Mel',
      clientUuid: tapUuid(world, n),
    }),
  );
  await call(world, 'tihara', 'post', `/load-flags/${flag.id}/decision`, {
    decision: 'REPLACE',
    note: 'Replace from stock',
  });
  await call(world, 'harini', 'post', `/load-flags/${flag.id}/recheck`, {
    qtyLoaded: before.qtyExpected,
    checkedByName: 'Harini De Mel',
    clientUuid: tapUuid(world, n + 1),
  });
  expect(await lineRow(world, lineId)).toMatchObject({ status: 'REPLACED' });
}
