import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import type { BatchResultsDto } from '../dto/batch.dto';
import type { LoadLineDto, LoadListDto } from '../dto/load-list.dto';
import type { BatchResult, LoaderEvent } from '../domain/loader-event';
import { LOAD_AUDIT, LOAD_EVENTS, LOAD_REJECTIONS } from '../loading.constants';
import {
  at,
  auditRows,
  buildWorld,
  call,
  checkEverything,
  closeWorld,
  data,
  DOCK_TABLET,
  flagRow,
  flagRows,
  lineRow,
  lineRows,
  outboxRows,
  publish,
  reset,
  seedTrip,
  syncAsLoader,
  tapUuid,
  tripRow,
  type World,
} from './loading.world';

const CHECKED_AT = '2026-10-02T02:45:10+05:30';

/**
 * Checking lines, refusing a short one, taking a check back, and replaying a
 * tablet's queue. AC-LOD-04, AC-LOD-05, AC-LOD-06 and AC-LOD-18.
 */
describeWithDb('loading: checks and undo (ROO-33)', () => {
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => closeWorld(w));
  beforeEach(async () => {
    await reset(w);
    at(w, '2026-10-02T02:40:00+05:30');
  });

  it('AC-LOD-04 checking lines', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 3, qty: 12 });
    await publish(w, trip);
    const lines = await lineRows(w, trip.tripId);
    expect(lines).toHaveLength(3);
    expect((await tripRow(w, trip.tripId)).status).toBe('PLANNED');

    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: lines.map((line, index) => ({
          lineId: line.id,
          qtyLoaded: 12,
          checkedByName: 'Harini De Mel',
          clientUuid: tapUuid(w, 10 + index),
          checkedAt: CHECKED_AT,
        })),
      },
    );
    expect(res.status).toBe(200);

    // One result per clientUuid, all applied.
    const body = data<BatchResultsDto>(res);
    expect(body.applied).toBe(3);
    expect(body.results.map((r) => r.clientUuid)).toEqual(
      lines.map((_, index) => tapUuid(w, 10 + index)),
    );
    for (const result of body.results) expect(result.status).toBe('applied');

    // The three lines are OK, with everything a shared tablet has to record.
    for (const [index, line] of lines.entries()) {
      const after = await lineRow(w, line.id);
      expect(after).toMatchObject({
        status: 'OK',
        qtyLoaded: 12,
        checkedByName: 'Harini De Mel',
        checkedByUserId: w.as.harini.id,
        clientUuid: tapUuid(w, 10 + index),
      });
      expect(after.checkedAt?.toISOString()).toBe(
        new Date(CHECKED_AT).toISOString(),
      );
      expect(after.deviceId).not.toBeNull();
    }

    // The trip is LOADING, moved through TripLifecycleService.
    expect((await tripRow(w, trip.tripId)).status).toBe('LOADING');

    // Exactly three audit rows, each carrying the device's own time and the
    // name typed on the tablet rather than the account's.
    const rows = await auditRows(w, LOAD_AUDIT.lineChecked);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.occurredAt.toISOString()).toBe(
        new Date(CHECKED_AT).toISOString(),
      );
      expect(row.actorName).toBe('Harini De Mel');
      expect(row.clientUuid).not.toBeNull();
    }
    expect(await outboxRows(w, LOAD_EVENTS.lineChecked)).toHaveLength(3);

    // Each checked line carries undo and no check.
    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    for (const line of list.stops[0].lines) {
      const links = line._links;
      expect(links.undo).toMatchObject({
        href: `/api/v1/load-lines/${line.id}/undo`,
        method: 'POST',
      });
      expect(links.check).toBeUndefined();
    }
    expect(list.progress).toMatchObject({
      lines: 3,
      checked: 3,
      outstanding: 0,
    });
  });

  it('AC-LOD-05 a short check needs a flag', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 12 });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);

    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: [
          {
            lineId: line.id,
            qtyLoaded: 10,
            checkedByName: 'Harini De Mel',
            clientUuid: tapUuid(w, 20),
            checkedAt: CHECKED_AT,
          },
        ],
      },
    );
    // The batch itself is fine; the item is not.
    expect(res.status).toBe(200);
    const body = data<BatchResultsDto>(res);
    expect(body.applied).toBe(0);
    expect(body.results[0]).toMatchObject({
      clientUuid: tapUuid(w, 20),
      status: 'rejected',
      code: LOAD_REJECTIONS.shortWithoutFlag,
    });
    expect(body.results[0].message).toContain('flag');

    // The line stays PENDING with no quantity, and nothing was audited.
    expect(await lineRow(w, line.id)).toMatchObject({
      status: 'PENDING',
      qtyLoaded: null,
      checkedByName: null,
    });
    expect(await auditRows(w, LOAD_AUDIT.lineChecked)).toHaveLength(0);
    expect(await outboxRows(w, LOAD_EVENTS.lineChecked)).toHaveLength(0);
    // And the trip did not start loading over a refused check.
    expect((await tripRow(w, trip.tripId)).status).toBe('PLANNED');
  });

  it('AC-LOD-06 a check can be undone until release', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 2, qty: 12 });
    await publish(w, trip);
    const lines = await lineRows(w, trip.tripId);
    await checkEverything(w, trip.tripId, 30);
    expect((await tripRow(w, trip.tripId)).status).toBe('LOADING');

    const undone = await call(
      w,
      'harini',
      'post',
      `/load-lines/${lines[0].id}/undo`,
      { checkedByName: 'Harini De Mel' },
    );
    expect(undone.status).toBe(200);
    expect(data<LoadLineDto>(undone)).toMatchObject({
      status: 'PENDING',
      qtyLoaded: null,
    });
    expect(await lineRow(w, lines[0].id)).toMatchObject({
      status: 'PENDING',
      qtyLoaded: null,
      checkedByName: null,
    });
    expect(await auditRows(w, LOAD_AUDIT.lineCheckUndone)).toHaveLength(1);

    // Once the trip is RELEASED the list is closed: 409, nothing changes,
    // and no line on the trip carries an undo link.
    await checkEverything(w, trip.tripId, 40);
    const released = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 49),
      },
    );
    expect(released.status).toBe(200);

    const before = await lineRow(w, lines[1].id);
    const refused = await call(
      w,
      'harini',
      'post',
      `/load-lines/${lines[1].id}/undo`,
    );
    expect(refused.status).toBe(409);
    expectProblem(refused, 'CONFLICT_STATE');
    expect(await lineRow(w, lines[1].id)).toEqual(before);
    expect(await auditRows(w, LOAD_AUDIT.lineCheckUndone)).toHaveLength(1);

    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    for (const line of list.stops[0].lines) {
      const links = line._links;
      expect(links.undo).toBeUndefined();
      expect(links.check).toBeUndefined();
      expect(links.flag).toBeUndefined();
    }
  });

  it('AC-LOD-18 offline loader events apply once, in order', async () => {
    const trip = await seedTrip(w, { stops: 2, lines: 1, qty: 12 });
    await publish(w, trip);
    const lines = await lineRows(w, trip.tripId);
    const [lineB, lineA] = lines; // stop 2 first: the list is last stop first

    // What Harini's tablet recorded with no signal: a check on line A, a
    // flag on line B, and the undo of that flag.
    const queued: LoaderEvent[] = [
      {
        clientUuid: tapUuid(w, 51),
        type: 'LOAD_LINE_CHECKED',
        loadLineId: lineA.id,
        qtyLoaded: 12,
        checkedByName: 'Harini De Mel',
        occurredAt: new Date('2026-10-02T02:50:00+05:30'),
        deviceSeq: 1,
        deviceId: DOCK_TABLET,
      },
      {
        clientUuid: tapUuid(w, 52),
        type: 'LOAD_FLAG_RAISED',
        loadLineId: lineB.id,
        reason: 'MISSING',
        qtyAffected: 2,
        checkedByName: 'Harini De Mel',
        note: '2 cases missing',
        occurredAt: new Date('2026-10-02T02:52:00+05:30'),
        deviceSeq: 2,
        deviceId: DOCK_TABLET,
      },
      {
        clientUuid: tapUuid(w, 53),
        type: 'LOAD_FLAG_UNDONE',
        loadFlagId: '', // filled in once the flag exists; see below
        occurredAt: new Date('2026-10-02T02:53:00+05:30'),
        deviceSeq: 3,
        deviceId: DOCK_TABLET,
      },
    ];

    // The tablet knows the flag it raised by its own clientUuid, not by the
    // server's id, so it is the first two events that have to land before
    // the third can name it. Sending 3, 1, 2 is exactly the case the
    // criterion is about, so the undo is addressed by the flag the raise
    // creates: apply the first two, then send all three out of order.
    const first = await syncAsLoader(w, [queued[0], queued[1]]);
    expect(first.map((r) => r.status)).toEqual(['applied', 'applied']);
    const [flag] = await flagRows(w, trip.tripId);
    queued[2] = { ...queued[2], loadFlagId: flag.id };

    // Now the whole batch arrives in the order 3, 1, 2 — and applies in
    // deviceSeq order, so the undo lands after the raise it undoes.
    const results = await syncAsLoader(w, [queued[2], queued[0], queued[1]]);
    expect(byUuid(results, tapUuid(w, 53)).status).toBe('applied');
    expect(byUuid(results, tapUuid(w, 51)).status).toBe('duplicate');
    expect(byUuid(results, tapUuid(w, 52)).status).toBe('duplicate');

    expect(await lineRow(w, lineA.id)).toMatchObject({
      status: 'OK',
      qtyLoaded: 12,
    });
    const undone = await flagRow(w, flag.id);
    expect(undone).toMatchObject({ status: 'RESOLVED', decision: null });
    expect(undone.resolvedAt).not.toBeNull();
    expect(await lineRow(w, lineB.id)).toMatchObject({ status: 'PENDING' });

    // Each audit row carries the occurredAt its event brought from the
    // device, not the moment the server caught up.
    const checks = await auditRows(w, LOAD_AUDIT.lineChecked);
    expect(checks).toHaveLength(1);
    expect(checks[0].occurredAt.toISOString()).toBe(
      new Date('2026-10-02T02:50:00+05:30').toISOString(),
    );
    expect(checks[0].source).toBe('OFFLINE_SYNC');
    const raised = await auditRows(w, LOAD_AUDIT.flagRaised);
    expect(raised[0].occurredAt.toISOString()).toBe(
      new Date('2026-10-02T02:52:00+05:30').toISOString(),
    );

    // The same batch again: every result is a duplicate, nothing is added
    // and nothing changes.
    const again = await syncAsLoader(w, [queued[2], queued[0], queued[1]]);
    expect(again.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
    expect(await auditRows(w, LOAD_AUDIT.lineChecked)).toHaveLength(1);
    expect(await auditRows(w, LOAD_AUDIT.flagRaised)).toHaveLength(1);
    expect(await auditRows(w, LOAD_AUDIT.flagUndone)).toHaveLength(1);
    expect(await flagRows(w, trip.tripId)).toHaveLength(1);
    expect(await lineRow(w, lineA.id)).toMatchObject({ qtyLoaded: 12 });
  });

  it('calls a replayed check a duplicate and audits nothing twice', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 12 });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);
    const body = {
      checks: [
        {
          lineId: line.id,
          qtyLoaded: 12,
          checkedByName: 'Harini De Mel',
          clientUuid: tapUuid(w, 60),
          checkedAt: CHECKED_AT,
        },
      ],
    };
    const first = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      body,
    );
    expect(data<BatchResultsDto>(first).results[0].status).toBe('applied');

    const second = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      body,
    );
    expect(second.status).toBe(200);
    expect(data<BatchResultsDto>(second).results[0]).toMatchObject({
      status: 'duplicate',
      id: line.id,
    });
    expect(await auditRows(w, LOAD_AUDIT.lineChecked)).toHaveLength(1);
    expect(await outboxRows(w, LOAD_EVENTS.lineChecked)).toHaveLength(1);
  });

  it('refuses a check over the quantity ordered', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 12 });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: [
          {
            lineId: line.id,
            qtyLoaded: 14,
            checkedByName: 'Harini De Mel',
            clientUuid: tapUuid(w, 70),
            checkedAt: CHECKED_AT,
          },
        ],
      },
    );
    expect(data<BatchResultsDto>(res).results[0]).toMatchObject({
      status: 'rejected',
      code: LOAD_REJECTIONS.overExpected,
    });
    expect(await lineRow(w, line.id)).toMatchObject({ status: 'PENDING' });
  });

  it('refuses a check aimed at another trip’s line', async () => {
    const mine = await seedTrip(w, { stops: 1, lines: 1 });
    const other = await seedTrip(w, {
      stops: 1,
      lines: 1,
      tripNo: 2,
      vehicle: 'dry',
    });
    await publish(w, mine, { tripIds: [mine.tripId, other.tripId] });
    const [theirs] = await lineRows(w, other.tripId);

    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${mine.tripId}/load-list/checks`,
      {
        checks: [
          {
            lineId: theirs.id,
            qtyLoaded: 12,
            checkedByName: 'Harini De Mel',
            clientUuid: tapUuid(w, 80),
            checkedAt: CHECKED_AT,
          },
        ],
      },
    );
    expect(data<BatchResultsDto>(res).results[0]).toMatchObject({
      status: 'rejected',
      code: LOAD_REJECTIONS.lineNotFound,
    });
    expect(await lineRow(w, theirs.id)).toMatchObject({ status: 'PENDING' });
  });

  it('refuses a check on a line that is already checked', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 12 });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);
    await checkEverything(w, trip.tripId, 85);

    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: [
          {
            lineId: line.id,
            qtyLoaded: 12,
            checkedByName: 'Harini De Mel',
            clientUuid: tapUuid(w, 88),
            checkedAt: CHECKED_AT,
          },
        ],
      },
    );
    expect(data<BatchResultsDto>(res).results[0]).toMatchObject({
      status: 'rejected',
      code: LOAD_REJECTIONS.lineNotCheckable,
    });
  });
});

const byUuid = (results: readonly BatchResult[], clientUuid: string) =>
  results.find((result) => result.clientUuid === clientUuid)!;
