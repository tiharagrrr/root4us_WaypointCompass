import type { Actor, Links } from '@waypoint/shared';
import request, { type Response } from 'supertest';
import { browser } from '../../../../test/auth';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { ClockService } from '../../../core/clock/clock.service';
import { alerts } from '../../../db/schema';
import {
  ALERT_AUDIT,
  ALERT_EVENTS,
  ALERT_RAISED_BY,
  ALERT_RESOLVED_BY,
} from '../alerts.constants';
import { dedupeKeyFor } from '../domain/dedupe-key';
import { AlertLinks } from '../policies/alert.links';
import type { AlertRow } from '../services/alerts.service';
import {
  anId,
  auditRows,
  buildWorld,
  closeWorld,
  deliver,
  oneAlert,
  outboxRows,
  type Role,
  type World,
} from './alerts.world';

const at = (time: string) => `2026-10-02T${time}+05:30`;

interface Envelope<T> {
  data: T;
  meta: { page?: { limit: number; offset: number; total: number } };
  _links?: Links;
}

type AlertBody = Record<string, unknown> & { id: string; _links: Links };

const get = (w: World, path: string, who: Role): Promise<Response> =>
  request(w.app.getHttpServer())
    .get(path)
    .set(browser())
    .set('Cookie', w.as[who].cookie);

const post = (
  w: World,
  path: string,
  who: Role,
  body?: Record<string, unknown>,
): Promise<Response> =>
  request(w.app.getHttpServer())
    .post(path)
    .set(browser())
    .set('Cookie', w.as[who].cookie)
    .send(body ?? {});

describeWithDb('alerts: the API (ROO-50)', () => {
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => closeWorld(w));

  it('AC-ALR-07 fix links follow the affordance rule', async () => {
    const flagId = anId();
    const tripId = anId();
    const key = dedupeKeyFor('LOADER_SHORTFALL', {
      kind: 'load_flag',
      id: flagId,
    });
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.loadFlagRaised,
        payload: {
          v: 1,
          flagId,
          tripId,
          reason: 'MISSING',
          plannedDepartAt: at('06:00:00'),
        },
      },
      at('04:50:00'),
    );
    const alert = await oneAlert(w, key);

    // Tihara is a dispatcher over every depot and holds load:decide.
    const mine = await get(w, `/api/v1/alerts/${alert.id}`, 'tihara');
    expect(mine.status).toBe(200);
    const links = (mine.body as Envelope<AlertBody>).data._links;
    expect(links.self).toEqual({ href: `/api/v1/alerts/${alert.id}` });
    expect(links.acknowledge).toMatchObject({
      href: `/api/v1/alerts/${alert.id}/acknowledge`,
      method: 'POST',
    });
    expect(links.resolve).toMatchObject({
      href: `/api/v1/alerts/${alert.id}/resolve`,
      method: 'POST',
      requires: ['note'],
    });
    expect(links.decide).toEqual({
      href: `/api/v1/load-flags/${flagId}/decision`,
      method: 'POST',
      title: 'Decide the flag',
      requires: ['decision', 'reasonCode'],
    });

    // A dispatcher scoped to Kandy is told nothing: not 403, which would
    // confirm the alert exists, but the same 404 as a missing one.
    const theirs = await get(w, `/api/v1/alerts/${alert.id}`, 'kandy');
    expect(theirs.status).toBe(404);
    expectProblem(theirs, 'NOT_FOUND');
    const theirList = await get(w, '/api/v1/alerts', 'kandy');
    expect(theirList.status).toBe(200);
    expect(
      (theirList.body as Envelope<AlertBody[]>).data.map((row) => row.id),
    ).not.toContain(alert.id);

    // An actor who may act on alerts but not decide a flag is offered the
    // alert's own actions and no fix. Rendered through AlertLinks directly:
    // every dispatcher in the matrix holds load:decide, so this viewer only
    // exists as a question about the rule.
    const builder = new AlertLinks(w.app.get(ClockService));
    const withoutDecide = {
      ...fakeActor(w, 'dispatcher'),
      role: 'dispatcher',
    } as Actor;
    const full = builder.one(alert, withoutDecide)._links;
    const noDecide = builder.one(alert, {
      ...withoutDecide,
      role: 'loader',
    })._links;
    expect(full.decide).toBeDefined();
    expect(noDecide.decide).toBeUndefined();
    // "its other links are unchanged": a loader holds no alert:act either, so
    // compare against what a permission-less viewer should still see.
    expect(Object.keys(noDecide).sort()).toEqual(['self', 'trip']);

    // Once the flag is decided the alert closes, and offers nothing at all.
    await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.loadFlagDecided,
        payload: { v: 1, flagId, tripId },
      },
      at('04:55:00'),
    );
    const done = await get(w, `/api/v1/alerts/${alert.id}`, 'tihara');
    const closedLinks = (done.body as Envelope<AlertBody>).data._links;
    expect((done.body as Envelope<AlertBody>).data.status).toBe('RESOLVED');
    expect(closedLinks.decide).toBeUndefined();
    expect(closedLinks.acknowledge).toBeUndefined();
    expect(closedLinks.resolve).toBeUndefined();
  });

  it('AC-ALR-08 acknowledge and resolve by hand', async () => {
    const tripId = anId();
    const key = dedupeKeyFor('VEHICLE_OFFLINE', { kind: 'trip', id: tripId });
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.vehicleOffline,
        payload: { v: 1, tripId, minutesSilent: 31 },
      },
      at('05:40:00'),
    );
    const alert = await oneAlert(w, key);

    w.app.get(ClockService).freeze(at('05:45:00'));
    const ack = await post(
      w,
      `/api/v1/alerts/${alert.id}/acknowledge`,
      'tihara',
    );
    expect(ack.status).toBe(200);
    const acked = (ack.body as Envelope<AlertBody>).data;
    expect(acked).toMatchObject({
      status: 'ACKNOWLEDGED',
      acknowledgedById: w.as.tihara.id,
      acknowledgedAt: '2026-10-02T05:45:00+05:30',
    });
    // It is Tihara's now, so she can still resolve it and nobody can take it.
    expect(acked._links.resolve).toBeDefined();
    expect(acked._links.acknowledge).toBeUndefined();

    expect(
      await outboxRows(w, ALERT_EVENTS.acknowledged, alert.id),
    ).toHaveLength(1);
    expect(await auditRows(w, ALERT_AUDIT.acknowledged, alert.id)).toHaveLength(
      1,
    );
    // Another dispatcher's 01 learns who is on it over SSE, which realtime
    // delivers from this depot-routed event (specs/alerts/spec.md, Scope).
    const [announced] = await outboxRows(
      w,
      ALERT_EVENTS.acknowledged,
      alert.id,
    );
    expect(announced.payload).toMatchObject({ status: 'ACKNOWLEDGED' });
    expect(announced.depotId).toBe(w.depot.plg);

    const twice = await post(
      w,
      `/api/v1/alerts/${alert.id}/acknowledge`,
      'tihara',
    );
    expect(twice.status).toBe(409);
    expectProblem(twice, 'CONFLICT_STATE');

    const noNote = await post(
      w,
      `/api/v1/alerts/${alert.id}/resolve`,
      'tihara',
    );
    expect(noNote.status).toBe(400);
    const problem = expectProblem(noNote, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'note' })]),
    );

    const done = await post(w, `/api/v1/alerts/${alert.id}/resolve`, 'tihara', {
      note: 'Driver reached by phone',
    });
    expect(done.status).toBe(200);
    const resolved = (done.body as Envelope<AlertBody>).data;
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      resolution: 'Driver reached by phone',
      resolvedById: w.as.tihara.id,
    });
    expect(resolved._links.acknowledge).toBeUndefined();
    expect(resolved._links.resolve).toBeUndefined();
    expect(await outboxRows(w, ALERT_EVENTS.resolved, alert.id)).toHaveLength(
      1,
    );

    const resolvedTwice = await post(
      w,
      `/api/v1/alerts/${alert.id}/resolve`,
      'tihara',
      { note: 'Again' },
    );
    expect(resolvedTwice.status).toBe(409);
    expectProblem(resolvedTwice, 'CONFLICT_STATE');
  });

  it('AC-ALR-09 the list, its order and access', async () => {
    // Seeded as rows rather than through events: the criterion is about the
    // order three given alerts come back in, so it states them directly.
    const list = await buildWorld();
    try {
      const rows = await list.db
        .insert(alerts)
        .values([
          row(list, 'STORE_ISSUE', 3, 'OPEN', at('04:00:00'), 'A'),
          row(list, 'SYNC_CONFLICT', 1, 'OPEN', at('05:00:00'), 'B'),
          row(list, 'DRIVER_CANT_RUN', 1, 'RESOLVED', at('03:00:00'), 'C'),
        ])
        .returning();
      const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.id]));

      // Open first, then severity: B (open, critical), A (open, info), then
      // the day's resolved C underneath. Asked as the depot's own dispatcher,
      // whose scope is these three alerts and nothing else.
      const all = await get(list, '/api/v1/alerts', 'plg');
      expect(all.status).toBe(200);
      const body = all.body as Envelope<AlertBody[]>;
      expect(body.data.map((a) => a.id)).toEqual([
        byTitle.B,
        byTitle.A,
        byTitle.C,
      ]);
      expect(body.meta.page).toEqual({ limit: 10, offset: 0, total: 3 });

      // Tihara is scoped to no depot, so she needs the depot filter to get
      // the same panel; without it she would be reading every depot's day.
      const hers = await get(
        list,
        `/api/v1/alerts?filter[depotId]=${list.depot.plg}`,
        'tihara',
      );
      expect(
        (hers.body as Envelope<AlertBody[]>).data.map((a) => a.id),
      ).toEqual([byTitle.B, byTitle.A, byTitle.C]);

      const critical = await get(
        list,
        '/api/v1/alerts?filter[status]=OPEN&filter[severity]=1',
        'plg',
      );
      const filtered = critical.body as Envelope<AlertBody[]>;
      expect(filtered.data.map((a) => a.id)).toEqual([byTitle.B]);
      expect(filtered.meta.page?.total).toBe(1);

      // outletId is not on the whitelist: a dispatcher-only resource is
      // filtered by depot, which is the scope, and by trip.
      const wrong = await get(
        list,
        `/api/v1/alerts?filter[outletId]=${list.kadawatha}`,
        'plg',
      );
      expect(wrong.status).toBe(400);
      const problem = expectProblem(wrong, 'VALIDATION_FAILED');
      expect(problem.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'filter[outletId]' }),
        ]),
      );

      // Alerts are the dispatcher's queue; nobody else holds alert:read.
      for (const who of ['loader', 'store', 'driver', 'admin'] as const) {
        const denied = await get(list, '/api/v1/alerts', who);
        expect(denied.status).toBe(403);
        expectProblem(denied, 'FORBIDDEN');
      }
    } finally {
      await closeWorld(list);
    }
  });
});

/** One alert row, stated the way the list criterion states it. */
function row(
  w: World,
  type: AlertRow['type'],
  severity: number,
  status: AlertRow['status'],
  raisedAt: string,
  title: string,
): typeof alerts.$inferInsert {
  const id = anId();
  return {
    type,
    status,
    severity,
    depotId: w.depot.plg,
    title,
    dedupeKey: `${type}:trip:${id}`,
    raisedAt: new Date(raisedAt),
    ...(status === 'RESOLVED' ? { resolvedAt: new Date(raisedAt) } : {}),
  };
}

/** An actor shaped like the signed-in one, for a links-only question. */
const fakeActor = (w: World, role: string): Actor =>
  ({
    id: w.as.tihara.id,
    name: 'Tihara Egodage',
    role,
    depotId: null,
    outletId: null,
  }) as unknown as Actor;
