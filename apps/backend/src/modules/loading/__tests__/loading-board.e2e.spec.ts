import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import type {
  LoadListDto,
  LoadRunDto,
  LoadTripSummaryDto,
} from '../dto/load-list.dto';
import {
  at,
  buildWorld,
  call,
  closeWorld,
  data,
  DAY,
  lineRows,
  publish,
  reset,
  seedOtherDepotTrip,
  seedTrip,
  tapUuid,
  type Role,
  type World,
} from './loading.world';

/**
 * Who may see a dock's work, and whose. AC-LOD-02 and AC-LOD-03.
 *
 * These two criteria are the whole of loading's scope and permission story,
 * so they are kept together: one says a loader sees their own depot's day
 * and nothing else, the other says the four roles with no load permission
 * get 403 before the scope is ever consulted.
 */
describeWithDb('loading: the dock board and its permissions (ROO-33)', () => {
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => closeWorld(w));
  beforeEach(async () => {
    await reset(w);
    at(w, '2026-10-02T02:40:00+05:30');
  });

  it('AC-LOD-02 the dock sees its own trips', async () => {
    const run1 = await seedTrip(w, { stops: 6, lines: 1, wave: 'run1' });
    const run2 = await seedTrip(w, {
      stops: 2,
      lines: 1,
      wave: 'run2',
      tripNo: 2,
      vehicle: 'dry',
      tempClass: 'AMBIENT',
    });
    // Yesterday's Peliyagoda trip, which a loader must not be able to reach.
    const yesterday = await seedTrip(w, { stops: 1, date: '2026-10-01' });
    await publish(w, run1, { tripIds: [run1.tripId, run2.tripId] });
    await publish(w, yesterday, {
      tripIds: [yesterday.tripId],
      revision: 1,
    });

    // The runs board: the day's trips by wave, each with its progress and
    // its count of open flags.
    const runs = data<LoadRunDto[]>(
      await call(
        w,
        'harini',
        'get',
        `/depots/${w.depot.plg}/loading/runs?date=${DAY}`,
      ),
    );
    expect(runs.map((run) => run.waveId)).toEqual([w.waves.run1, w.waves.run2]);
    expect(runs[0].trips.map((trip) => trip.id)).toEqual([run1.tripId]);
    expect(runs[0].progress).toMatchObject({
      lines: 6,
      checked: 0,
      outstanding: 6,
      openFlags: 0,
    });
    expect(runs[0].trips[0]).toMatchObject({ outletCount: 6 });
    expect(runs[1].progress).toMatchObject({ lines: 2, outstanding: 2 });

    // Asking for one wave returns only that wave's trips.
    const wave2 = data<LoadTripSummaryDto[]>(
      await call(
        w,
        'harini',
        'get',
        `/depots/${w.depot.plg}/loading/trips?date=${DAY}&wave=${w.waves.run2}`,
      ),
    );
    expect(wave2.map((trip) => trip.id)).toEqual([run2.tripId]);

    // A Kandy trip, and a Peliyagoda trip dated yesterday, each answer 404
    // — the same body as a trip that does not exist, so a loader learns
    // nothing about either.
    const kandyTrip = await seedOtherDepotTrip(w);
    for (const tripId of [kandyTrip, yesterday.tripId]) {
      const res = await call(w, 'harini', 'get', `/trips/${tripId}/load-list`);
      expect(res.status).toBe(404);
      expectProblem(res, 'NOT_FOUND');
    }
    // And yesterday's board comes back empty rather than with yesterday.
    expect(
      data<LoadRunDto[]>(
        await call(
          w,
          'harini',
          'get',
          `/depots/${w.depot.plg}/loading/runs?date=2026-10-01`,
        ),
      ),
    ).toEqual([]);

    // Tihara is a dispatcher over every depot: she reads the list and is
    // offered nothing to press on it.
    const res = await call(
      w,
      'tihara',
      'get',
      `/trips/${run1.tripId}/load-list`,
    );
    expect(res.status).toBe(200);
    const list = data<LoadListDto>(res);
    const links = list._links;
    expect(links.self).toBeDefined();
    for (const rel of ['checks', 'flag', 'release']) {
      expect(links[rel]).toBeUndefined();
    }
    for (const group of list.stops)
      for (const line of group.lines) {
        const own = line._links;
        expect(own.check).toBeUndefined();
        expect(own.flag).toBeUndefined();
        expect(own.undo).toBeUndefined();
      }

    // A dispatcher scoped to Kandy gets the same 404 as the loader.
    const theirs = await call(
      w,
      'kandy',
      'get',
      `/trips/${run1.tripId}/load-list`,
    );
    expect(theirs.status).toBe(404);
    expectProblem(theirs, 'NOT_FOUND');
  });

  it('AC-LOD-03 roles without the permission are refused', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1 });
    await publish(w, trip);
    const [line] = await lineRows(w, trip.tripId);

    // Driver, store manager and admin hold no load permission at all.
    for (const role of ['driver', 'store', 'admin'] as Role[]) {
      const res = await call(w, role, 'get', `/trips/${trip.tripId}/load-list`);
      expect(res.status).toBe(403);
      expectProblem(res, 'FORBIDDEN');
    }

    // A dispatcher reads, but does not check or release.
    const check = await call(
      w,
      'tihara',
      'post',
      `/trips/${trip.tripId}/load-list/checks`,
      {
        checks: [
          {
            lineId: line.id,
            qtyLoaded: 12,
            checkedByName: 'Tihara Egodage',
            clientUuid: tapUuid(w, 200),
            checkedAt: '2026-10-02T02:45:10+05:30',
          },
        ],
      },
    );
    expect(check.status).toBe(403);
    expectProblem(check, 'FORBIDDEN');
    const release = await call(
      w,
      'tihara',
      'post',
      `/trips/${trip.tripId}/release`,
      {
        reeferTempC: 3.4,
        checkedByName: 'Tihara Egodage',
        clientUuid: tapUuid(w, 201),
      },
    );
    expect(release.status).toBe(403);
    // Nothing changed: the line is still PENDING and the trip still PLANNED.
    expect((await lineRows(w, trip.tripId))[0]).toMatchObject({
      status: 'PENDING',
      qtyLoaded: null,
    });

    // And a loader does not decide a flag.
    const flag = data<{ id: string }>(
      await call(w, 'harini', 'post', `/trips/${trip.tripId}/load-flags`, {
        loadLineId: line.id,
        reason: 'MISSING',
        qtyAffected: 2,
        raisedByName: 'Harini De Mel',
        clientUuid: tapUuid(w, 202),
      }),
    );
    const decide = await call(
      w,
      'harini',
      'post',
      `/load-flags/${flag.id}/decision`,
      { decision: 'REPLACE' },
    );
    expect(decide.status).toBe(403);
    expectProblem(decide, 'FORBIDDEN');
  });

  it('answers 404 for a trip in another depot’s board', async () => {
    const kandyTrip = await seedOtherDepotTrip(w);
    const res = await call(w, 'harini', 'get', `/trips/${kandyTrip}/load-list`);
    expect(res.status).toBe(404);
  });

  it('defaults the board to today on the demo clock', async () => {
    const trip = await seedTrip(w, { stops: 1, lines: 1 });
    await publish(w, trip);
    const runs = data<LoadRunDto[]>(
      await call(w, 'harini', 'get', `/depots/${w.depot.plg}/loading/runs`),
    );
    expect(runs[0].trips.map((t) => t.id)).toEqual([trip.tripId]);
  });

  it('rejects a filter the flag queue does not offer', async () => {
    const res = await call(
      w,
      'tihara',
      'get',
      '/load-flags?filter[depotId]=PLG',
    );
    expect(res.status).toBe(400);
    expectProblem(res, 'VALIDATION_FAILED');
  });
});
