import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import type { LoadFlagDto, LoadListDto } from '../dto/load-list.dto';
import { LOAD_AUDIT, LOAD_EVENTS } from '../loading.constants';
import {
  at,
  auditRows,
  backorderRows,
  buildWorld,
  call,
  captureLogs,
  closeWorld,
  data,
  deferralRows,
  flagRow,
  flagRows,
  lineRow,
  lineRows,
  meta,
  orderRow,
  outboxRows,
  planRow,
  publish,
  reset,
  revisionRows,
  seedTrip,
  tapUuid,
  type World,
} from './loading.world';

/**
 * The flag loop, L3 to L3c: raise, undo, decide, re-check, and what a REMOVE
 * costs the store. AC-LOD-07 to AC-LOD-12.
 */
describeWithDb('loading: flags and decisions (ROO-33)', () => {
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => closeWorld(w));
  beforeEach(async () => {
    await reset(w);
    at(w, '2026-10-02T03:05:00+05:30');
  });

  /** A published trip with one WF order of 12, and its one PENDING line. */
  async function aTripWithOneLine() {
    const trip = await seedTrip(w, { stops: 1, lines: 1, qty: 12 });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);
    return { trip, line };
  }

  /** Harini raises a MISSING flag for 2 of the 12. */
  async function aMissingFlag(n = 300) {
    const { trip, line } = await aTripWithOneLine();
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      {
        loadLineId: line.id,
        reason: 'MISSING',
        qtyAffected: 2,
        note: '2 cases missing',
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, n),
      },
    );
    expect(res.status).toBe(201);
    return { trip, line, flag: data<LoadFlagDto>(res), res };
  }

  it('AC-LOD-07 flag a missing item', async () => {
    const logs = captureLogs();
    try {
      const { trip, line, flag, res } = await aMissingFlag(300);

      // 201 with Location, and the flag is OPEN.
      expect(res.headers.location).toBe(`/api/v1/load-flags/${flag.id}`);
      expect(flag).toMatchObject({
        status: 'OPEN',
        reason: 'MISSING',
        qtyAffected: 2,
        note: '2 cases missing',
        raisedByName: 'Harini De Mel',
        raisedByUserId: w.as.harini.id,
      });
      expect(flag.raisedAt).toBe('2026-10-02T03:05:00+05:30');

      // The line is FLAGGED.
      expect(await lineRow(w, line.id)).toMatchObject({ status: 'FLAGGED' });

      // Exactly one audit row carrying the reason, and one outbox event.
      const rows = await auditRows(w, LOAD_AUDIT.flagRaised, flag.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        reasonCode: 'MISSING',
        reasonNote: '2 cases missing',
        actorName: 'Harini De Mel',
      });
      const emitted = await outboxRows(w, LOAD_EVENTS.flagRaised, flag.id);
      expect(emitted).toHaveLength(1);
      // The payload is what alerts parses to raise LOADER_SHORTFALL and
      // decide whether it is critical (AC-ALR-05).
      expect(emitted[0].payload).toMatchObject({
        v: 1,
        flagId: flag.id,
        tripId: trip.tripId,
        reason: 'MISSING',
        qtyAffected: 2,
        plannedDepartAt: '2026-10-02T03:30:00+05:30',
      });
      expect(emitted[0].outletIds).toEqual([w.kadawatha]);
      expect(logs.withEvent(LOAD_AUDIT.flagRaised)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ flagId: flag.id, reason: 'MISSING' }),
        ]),
      );

      // Tihara's queue lists it. She is scoped to no depot, so her queue is
      // every depot's; the exact total is asserted on the same query narrowed
      // to this trip, because the suites share one database and another
      // world's open flags are legitimately in her unfiltered queue. Newest
      // first, so earlier runs' flags left in that database cannot push this
      // one off the page.
      const queue = await call(
        w,
        'tihara',
        'get',
        '/load-flags?filter[status]=OPEN&sort=-raisedAt&limit=100',
      );
      expect(queue.status).toBe(200);
      expect(data<LoadFlagDto[]>(queue).map((row) => row.id)).toContain(
        flag.id,
      );
      const mineOnly = await call(
        w,
        'tihara',
        'get',
        `/load-flags?filter[status]=OPEN&filter[tripId]=${trip.tripId}`,
      );
      expect(data<LoadFlagDto[]>(mineOnly).map((row) => row.id)).toEqual([
        flag.id,
      ]);
      expect(meta(mineOnly).page).toMatchObject({ total: 1 });

      // Harini is offered undo and no decide; Tihara the other way round.
      expect(flag._links.undo).toMatchObject({
        href: `/api/v1/load-flags/${flag.id}/undo`,
        method: 'POST',
      });
      expect(flag._links.decide).toBeUndefined();
      const theirs = data<LoadFlagDto[]>(mineOnly)[0]._links;
      expect(theirs.decide).toMatchObject({
        href: `/api/v1/load-flags/${flag.id}/decision`,
        method: 'POST',
        requires: ['decision', 'reasonCode'],
      });
      expect(theirs.undo).toBeUndefined();
    } finally {
      logs.restore();
    }
  });

  it('AC-LOD-08 flags and removals need reasons', async () => {
    const { trip, line } = await aTripWithOneLine();

    // A flag with no reason is a 400 on `reason`, and nothing exists after.
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      {
        loadLineId: line.id,
        qtyAffected: 2,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 310),
      },
    );
    expect(res.status).toBe(400);
    const problem = expectProblem(res, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'reason' })]),
    );
    expect(await flagRows(w, trip.tripId)).toHaveLength(0);
    expect(await auditRows(w, LOAD_AUDIT.flagRaised)).toHaveLength(0);
    expect(await outboxRows(w, LOAD_EVENTS.flagRaised)).toHaveLength(0);

    // A REMOVE with no reason code is a 400 on `reasonCode`, and the flag,
    // the line, the plan and the order are all unchanged.
    const { flag } = await aMissingFlag(311);
    const before = {
      flag: await flagRow(w, flag.id),
      line: await lineRow(w, line.id),
      plan: await planRow(w, trip.planId),
    };
    const refused = await call(
      w,
      'tihara',
      'post',
      `/load-flags/${flag.id}/decision`,
      { decision: 'REMOVE' },
    );
    expect(refused.status).toBe(400);
    const reasonProblem = expectProblem(refused, 'VALIDATION_FAILED');
    expect(reasonProblem.errors).toEqual([
      {
        field: 'reasonCode',
        code: 'required',
        message: 'A reason is required',
      },
    ]);
    expect(await flagRow(w, flag.id)).toEqual(before.flag);
    expect(await planRow(w, trip.planId)).toEqual(before.plan);
    expect(await deferralRows(w, before.line.orderId)).toHaveLength(0);
  });

  it('AC-LOD-09 undo a flag before the decision', async () => {
    const { line, flag } = await aMissingFlag(320);

    const undone = await call(
      w,
      'harini',
      'post',
      `/load-flags/${flag.id}/undo`,
    );
    expect(undone.status).toBe(200);
    const after = data<LoadFlagDto>(undone);
    // RESOLVED as undone: resolvedAt set and no decision at all, which is
    // how 23 tells an undo from a REMOVE that resolved the same way.
    expect(after).toMatchObject({ status: 'RESOLVED', decision: null });
    expect(after.resolvedAt).not.toBeNull();
    expect(after.decidedById).toBeNull();

    // The line is no longer FLAGGED: back to PENDING, because it had not
    // been checked before the flag.
    expect(await lineRow(w, line.id)).toMatchObject({ status: 'PENDING' });
    expect(await auditRows(w, LOAD_AUDIT.flagUndone, flag.id)).toHaveLength(1);
    expect(await outboxRows(w, LOAD_EVENTS.flagResolved, flag.id)).toHaveLength(
      1,
    );
    // And nothing is left to press on it.
    const links = after._links;
    expect(links.undo).toBeUndefined();
    expect(links.decide).toBeUndefined();
    expect(links.recheck).toBeUndefined();

    // A flag Tihara has already decided cannot be undone.
    const second = await aMissingFlag(321);
    const decided = await call(
      w,
      'tihara',
      'post',
      `/load-flags/${second.flag.id}/decision`,
      { decision: 'REPLACE', note: 'Replace from stock' },
    );
    expect(decided.status).toBe(200);
    expect(data<LoadFlagDto>(decided)._links.undo).toBeUndefined();

    const refused = await call(
      w,
      'harini',
      'post',
      `/load-flags/${second.flag.id}/undo`,
    );
    expect(refused.status).toBe(409);
    expectProblem(refused, 'CONFLICT_STATE');
    expect(await flagRow(w, second.flag.id)).toMatchObject({
      status: 'AWAITING_RECHECK',
      decision: 'REPLACE',
    });
  });

  it('AC-LOD-10 the dispatcher asks for a replacement', async () => {
    const { trip, flag } = await aMissingFlag(330);

    const res = await call(
      w,
      'tihara',
      'post',
      `/load-flags/${flag.id}/decision`,
      { decision: 'REPLACE', note: 'Replace from stock' },
    );
    expect(res.status).toBe(200);
    const after = data<LoadFlagDto>(res);
    expect(after).toMatchObject({
      decision: 'REPLACE',
      status: 'AWAITING_RECHECK',
      decisionNote: 'Replace from stock',
      decidedById: w.as.tihara.id,
    });
    expect(after.decidedAt).not.toBeNull();

    // Exactly one audit row, and one outbox event carrying the trip, which
    // is what the web invalidates ['load-list', tripId] on.
    expect(await auditRows(w, LOAD_AUDIT.flagDecided, flag.id)).toHaveLength(1);
    const emitted = await outboxRows(w, LOAD_EVENTS.flagDecided, flag.id);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({
      v: 1,
      flagId: flag.id,
      tripId: trip.tripId,
      decision: 'REPLACE',
      deferralId: null,
      backorderId: null,
    });

    // Harini is offered the re-check, and neither undo nor decide.
    const mine = data<LoadFlagDto>(
      await call(w, 'harini', 'get', `/load-flags/${flag.id}`),
    );
    const links = mine._links;
    expect(links.recheck).toMatchObject({
      href: `/api/v1/load-flags/${flag.id}/recheck`,
      method: 'POST',
      requires: ['qtyLoaded', 'checkedByName', 'clientUuid'],
    });
    expect(links.undo).toBeUndefined();
    expect(links.decide).toBeUndefined();

    // A second dispatcher deciding the same flag changes nothing.
    const before = await flagRow(w, flag.id);
    const second = await call(
      w,
      'tihara',
      'post',
      `/load-flags/${flag.id}/decision`,
      { decision: 'REMOVE', reasonCode: w.reasons.damaged },
    );
    expect(second.status).toBe(409);
    expectProblem(second, 'CONFLICT_STATE');
    expect(await flagRow(w, flag.id)).toEqual(before);
    expect(await auditRows(w, LOAD_AUDIT.flagDecided, flag.id)).toHaveLength(1);
  });

  it('AC-LOD-11 the re-check resolves the flag', async () => {
    const { line, flag } = await aMissingFlag(340);
    await call(w, 'tihara', 'post', `/load-flags/${flag.id}/decision`, {
      decision: 'REPLACE',
      note: 'Replace from stock',
    });

    const res = await call(
      w,
      'harini',
      'post',
      `/load-flags/${flag.id}/recheck`,
      {
        qtyLoaded: 12,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 341),
      },
    );
    expect(res.status).toBe(200);
    const after = data<LoadFlagDto>(res);
    expect(after.status).toBe('RESOLVED');
    expect(after.resolvedAt).not.toBeNull();
    expect(await lineRow(w, line.id)).toMatchObject({
      status: 'REPLACED',
      qtyLoaded: 12,
      checkedByName: 'Harini De Mel',
    });
    expect(await auditRows(w, LOAD_AUDIT.flagRechecked, flag.id)).toHaveLength(
      1,
    );
    expect(await outboxRows(w, LOAD_EVENTS.flagResolved, flag.id)).toHaveLength(
      1,
    );

    // An OPEN flag with no decision yet cannot be re-checked.
    const second = await aMissingFlag(342);
    const refused = await call(
      w,
      'harini',
      'post',
      `/load-flags/${second.flag.id}/recheck`,
      {
        qtyLoaded: 12,
        checkedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 343),
      },
    );
    expect(refused.status).toBe(409);
    expectProblem(refused, 'CONFLICT_STATE');
    expect(await flagRow(w, second.flag.id)).toMatchObject({ status: 'OPEN' });
  });

  it('AC-LOD-12 removing an item defers part of the order', async () => {
    const logs = captureLogs();
    try {
      const { trip, line, flag } = await aMissingFlag(350);
      const order = await orderRow(w, line.orderId);
      expect((await planRow(w, trip.planId)).revision).toBe(1);

      const res = await call(
        w,
        'tihara',
        'post',
        `/load-flags/${flag.id}/decision`,
        {
          decision: 'REMOVE',
          reasonCode: w.reasons.capacity,
          note: 'No reefer space for the rest',
        },
      );
      expect(res.status).toBe(200);
      expect(data<LoadFlagDto>(res)).toMatchObject({
        status: 'RESOLVED',
        decision: 'REMOVE',
      });

      // The line is REMOVED, keeping the 10 cases that are in the building.
      expect(await lineRow(w, line.id)).toMatchObject({
        status: 'REMOVED',
        qtyExpected: 12,
        qtyLoaded: 10,
      });

      // Planning holds a partial deferral for the order, source LOAD_CHECK.
      const deferrals = await deferralRows(w, order.id);
      expect(deferrals).toHaveLength(1);
      expect(deferrals[0]).toMatchObject({
        partial: true,
        source: 'LOAD_CHECK',
        status: 'CONFIRMED',
        reasonCode: w.reasons.capacity,
        note: 'No reefer space for the rest',
        fromDate: '2026-10-02',
        toDate: '2026-10-03',
      });

      // Ordering holds a backorder for the removed quantity of 2, pointing
      // at the order it came from.
      const backorders = await backorderRows(w, order.id);
      expect(backorders).toHaveLength(1);
      expect(backorders[0]).toMatchObject({
        parentOrderId: order.id,
        source: 'backorder',
        status: 'CONFIRMED',
        units: 2,
        outletId: order.outletId,
        deliveryDate: '2026-10-03',
      });

      // The plan is at revision 2, and every line on the trip carries it.
      expect((await planRow(w, trip.planId)).revision).toBe(2);
      for (const row of await lineRows(w, trip.tripId))
        expect(row.planRevision).toBe(2);
      expect(await revisionRows(w, trip.planId)).toHaveLength(1);

      // Exactly one audit row with the reason code, and one outbox event.
      const rows = await auditRows(w, LOAD_AUDIT.flagDecided, flag.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reasonCode: w.reasons.capacity });
      const emitted = await outboxRows(w, LOAD_EVENTS.flagDecided, flag.id);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].payload).toMatchObject({
        decision: 'REMOVE',
        reasonCode: w.reasons.capacity,
        deferralId: deferrals[0].id,
        backorderId: backorders[0].id,
        revision: 2,
      });
      // The store is told through the event routed at its outlet; the
      // message itself is notifications' (specs/loading/spec.md, Scope).
      expect(emitted[0].outletIds).toEqual([order.outletId]);
      expect(logs.withEvent(LOAD_AUDIT.flagDecided)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            decision: 'REMOVE',
            reasonCode: w.reasons.capacity,
            revision: 2,
          }),
        ]),
      );
    } finally {
      logs.restore();
    }
  });

  it('AC-LOD-12 a removal before a closed day defers to the next operating day', async () => {
    // Saturday 3 Oct; Sunday 4 Oct does not operate (DEMO_DAYS), so the
    // goods are due on Monday's run, not on a day with no run at all.
    const trip = await seedTrip(w, {
      date: '2026-10-03',
      stops: 1,
      lines: 1,
      qty: 12,
    });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);
    const raised = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      {
        loadLineId: line.id,
        reason: 'MISSING',
        qtyAffected: 2,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 355),
      },
    );
    expect(raised.status).toBe(201);
    const flag = data<LoadFlagDto>(raised);

    const res = await call(
      w,
      'tihara',
      'post',
      `/load-flags/${flag.id}/decision`,
      { decision: 'REMOVE', reasonCode: w.reasons.capacity },
    );
    expect(res.status).toBe(200);

    const [deferral] = await deferralRows(w, line.orderId);
    expect(deferral).toMatchObject({
      fromDate: '2026-10-03',
      toDate: '2026-10-05',
    });
    const [backorder] = await backorderRows(w, line.orderId);
    expect(backorder).toMatchObject({ deliveryDate: '2026-10-05' });
  });

  it('refuses a reason code nobody registered', async () => {
    const { flag } = await aMissingFlag(360);
    const res = await call(
      w,
      'tihara',
      'post',
      `/load-flags/${flag.id}/decision`,
      {
        decision: 'REMOVE',
        reasonCode: 'NOT_A_REASON',
      },
    );
    expect(res.status).toBe(404);
    expect(await flagRow(w, flag.id)).toMatchObject({ status: 'OPEN' });
  });

  it('lets only the loader who raised a flag undo it', async () => {
    const { flag } = await aMissingFlag(370);
    const res = await call(w, 'loader2', 'post', `/load-flags/${flag.id}/undo`);
    expect(res.status).toBe(403);
    expectProblem(res, 'FORBIDDEN');
    expect(await flagRow(w, flag.id)).toMatchObject({ status: 'OPEN' });
    // And the other loader is not offered the link either.
    const theirs = data<LoadFlagDto>(
      await call(w, 'loader2', 'get', `/load-flags/${flag.id}`),
    );
    expect(theirs._links.undo).toBeUndefined();
  });

  it('refuses a second flag on a line that already carries one', async () => {
    const { trip, line } = await aMissingFlag(380);
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      {
        loadLineId: line.id,
        reason: 'DAMAGED',
        qtyAffected: 1,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 381),
      },
    );
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');
    expect(await flagRows(w, trip.tripId)).toHaveLength(1);
  });

  it('refuses a flag for more than the quantity ordered', async () => {
    const { trip, line } = await aTripWithOneLine();
    const res = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      {
        loadLineId: line.id,
        reason: 'DAMAGED',
        qtyAffected: 13,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 390),
      },
    );
    expect(res.status).toBe(400);
    const problem = expectProblem(res, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual([
      expect.objectContaining({ field: 'qtyAffected' }),
    ]);
  });

  it('keeps a replayed flag a duplicate, with one audit row', async () => {
    const { trip, line } = await aTripWithOneLine();
    const body = {
      loadLineId: line.id,
      reason: 'MISSING' as const,
      qtyAffected: 2,
      raisedByName: 'Harini De Mel',
      clientUuid: tapUuid(w, 395),
    };
    const first = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      body,
    );
    expect(first.status).toBe(201);
    const again = await call(
      w,
      'harini',
      'post',
      `/trips/${trip.tripId}/load-flags`,
      body,
    );
    expect(again.status).toBe(201);
    expect(data<LoadFlagDto>(again).id).toBe(data<LoadFlagDto>(first).id);
    expect(await flagRows(w, trip.tripId)).toHaveLength(1);
    expect(await auditRows(w, LOAD_AUDIT.flagRaised)).toHaveLength(1);
  });

  it('counts an open flag against the list and the board', async () => {
    const { trip } = await aMissingFlag(398);
    const list = data<LoadListDto>(
      await call(w, 'harini', 'get', `/trips/${trip.tripId}/load-list`),
    );
    expect(list.progress).toMatchObject({ openFlags: 1, outstanding: 1 });
    expect(list.stops[0].lines[0].flags).toHaveLength(1);
  });
});
