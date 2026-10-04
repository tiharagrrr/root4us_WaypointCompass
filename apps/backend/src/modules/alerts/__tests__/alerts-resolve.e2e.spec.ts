import type { Links } from '@waypoint/shared';
import request from 'supertest';
import { browser } from '../../../../test/auth';
import { describeWithDb } from '../../../../test/create-test-app';
import {
  ALERT_AUDIT,
  ALERT_EVENTS,
  ALERT_LOGS,
  ALERT_RAISED_BY,
  ALERT_RESOLVED_BY,
} from '../alerts.constants';
import { dedupeKeyFor } from '../domain/dedupe-key';
import {
  anId,
  auditRows,
  buildWorld,
  captureLogs,
  closeWorld,
  deliver,
  oneAlert,
  outboxRows,
  type CapturedLogs,
  type World,
} from './alerts.world';

const at = (time: string) => `2026-10-02T${time}+05:30`;

/** The alert as Tihara sees it, which is the only place links exist. */
async function asSeenByTihara(
  w: World,
  id: string,
): Promise<{ status: number; data: Record<string, unknown>; links: Links }> {
  const res = await request(w.app.getHttpServer())
    .get(`/api/v1/alerts/${id}`)
    .set(browser())
    .set('Cookie', w.as.tihara.cookie);
  const body = res.body as { data?: Record<string, unknown> };
  return {
    status: res.status,
    data: body.data ?? {},
    links: (body.data?._links ?? {}) as Links,
  };
}

describeWithDb('alerts: resolving themselves (ROO-50)', () => {
  let w: World;
  let logs: CapturedLogs;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => closeWorld(w));
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('AC-ALR-03 late risk clears itself', async () => {
    const stopId = anId();
    const tripId = anId();
    const key = dedupeKeyFor('LATE_RISK', { kind: 'stop', id: stopId });

    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId, lateRisk: 0.95, minutesLate: 5 },
      },
      at('07:30:00'),
    );
    const open = await oneAlert(w, key);
    expect(open.status).toBe('OPEN');

    // 15 minutes of slack reads 0.27, back under the 0.5 threshold.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId, lateRisk: 0.27, minutesLate: -15 },
      },
      at('07:42:00'),
    );

    const closed = await oneAlert(w, key);
    expect(closed.status).toBe('RESOLVED');
    expect(closed.resolvedAt?.toISOString()).toBe(
      new Date(at('07:42:00')).toISOString(),
    );
    // Nobody resolved it, so nobody is credited with it, and there is no note.
    expect(closed.resolvedById).toBeNull();
    expect(closed.resolution).toBeNull();

    expect(await outboxRows(w, ALERT_EVENTS.resolved, closed.id)).toHaveLength(
      1,
    );
    expect(
      await auditRows(w, ALERT_AUDIT.autoResolved, closed.id),
    ).toHaveLength(1);
    expect(
      logs
        .withEvent(ALERT_LOGS.autoResolved)
        .filter((line) => line.alertId === closed.id),
    ).toEqual([
      expect.objectContaining({ type: 'LATE_RISK', minutesOpen: 12 }),
    ]);

    // Nothing is offered on a resolved alert: not the two actions, and not
    // the fix either, because the fix is what closed it.
    const seen = await asSeenByTihara(w, closed.id);
    expect(seen.status).toBe(200);
    expect(Object.keys(seen.links).sort()).toEqual(['self', 'trip']);
  });

  it('AC-ALR-04 can’t run clears on reassign', async () => {
    const tripId = anId();
    const key = dedupeKeyFor('DRIVER_CANT_RUN', { kind: 'trip', id: tripId });

    // Dinushi reports CANT_RUN with reason breakdown at 05:05.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.tripCantRun,
        payload: {
          v: 1,
          tripId,
          vehicleId: anId(),
          driverId: w.as.driver.id,
          reason: 'BREAKDOWN',
          startedAlready: false,
        },
      },
      at('05:05:00'),
    );

    const open = await oneAlert(w, key);
    expect({ status: open.status, severity: open.severity }).toEqual({
      status: 'OPEN',
      severity: 1,
    });

    // Peliyagoda's dispatchers get a push: notifications sends it, and what
    // alerts owes is a depot-routed event that says it is critical
    // (specs/alerts/spec.md, Scope and Non-functional).
    const [raised] = await outboxRows(w, ALERT_EVENTS.raised, open.id);
    expect(raised.payload).toMatchObject({
      severity: 1,
      type: 'DRIVER_CANT_RUN',
    });
    expect(raised.depotId).toBe(w.depot.plg);

    // Tihara's view of it carries the fix.
    const seen = await asSeenByTihara(w, open.id);
    expect(seen.links.reassign).toEqual({
      href: `/api/v1/trips/${tripId}/reassign`,
      method: 'POST',
      title: 'Reassign the trip',
      requires: ['If-Match', 'reasonCode'],
    });

    // Tihara reassigns the trip at 05:20.
    await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.tripReassigned,
        payload: { v: 1, tripId },
      },
      at('05:20:00'),
    );

    const closed = await oneAlert(w, key);
    expect(closed.status).toBe('RESOLVED');
    expect(closed.resolvedAt?.toISOString()).toBe(
      new Date(at('05:20:00')).toISOString(),
    );
    expect(closed.resolvedById).toBeNull();
    expect(await outboxRows(w, ALERT_EVENTS.resolved, closed.id)).toHaveLength(
      1,
    );
    expect(
      logs
        .withEvent(ALERT_LOGS.autoResolved)
        .filter((line) => line.alertId === closed.id),
    ).toEqual([
      expect.objectContaining({ type: 'DRIVER_CANT_RUN', minutesOpen: 15 }),
    ]);
  });

  it('AC-ALR-13 an undone flag clears its shortfall', async () => {
    const flagId = anId();
    const tripId = anId();
    const key = dedupeKeyFor('LOADER_SHORTFALL', {
      kind: 'load_flag',
      id: flagId,
    });

    // Harini flags an item at 04:58; the dispatcher has not decided yet.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.loadFlagRaised,
        payload: {
          v: 1,
          flagId,
          tripId,
          reason: 'DAMAGED',
          plannedDepartAt: at('05:45:00'),
        },
      },
      at('04:58:00'),
    );
    expect((await oneAlert(w, key)).status).toBe('OPEN');

    // She undoes it at 05:00: loading says the flag is resolved, and nobody decided it.
    await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.loadFlagResolved,
        payload: { v: 1, flagId, tripId, how: 'UNDONE' },
      },
      at('05:00:00'),
    );

    const closed = await oneAlert(w, key);
    expect({
      status: closed.status,
      resolvedById: closed.resolvedById,
    }).toEqual({
      status: 'RESOLVED',
      resolvedById: null,
    });
  });

  it('AC-ALR-11 alerts never block the fix', async () => {
    // The sync half of this criterion — Aniqa's DELIVERED event being
    // applied and stop.completed emitted — is execution's and sync's, and is
    // covered by their own criteria; alerts cannot import either module
    // (specs/alerts/spec.md, depends-on). What is alerts' own is the rest:
    // the stop gets delivered whatever the alert says, and the alert closes
    // itself when it hears about it.
    const stopId = anId();
    const tripId = anId();
    const key = dedupeKeyFor('LATE_RISK', { kind: 'stop', id: stopId });

    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId, lateRisk: 0.95, minutesLate: 5 },
      },
      at('07:30:00'),
    );
    expect((await oneAlert(w, key)).status).toBe('OPEN');

    // `stop.completed` as execution publishes it (its Events table).
    const handled = await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.stopCompleted,
        payload: { v: 1, tripId, stopId },
      },
      at('07:58:00'),
    );

    expect(handled.resolved).toEqual([key]);
    const closed = await oneAlert(w, key);
    expect(closed.status).toBe('RESOLVED');
    expect(closed.resolvedById).toBeNull();
    expect(closed.resolvedAt?.toISOString()).toBe(
      new Date(at('07:58:00')).toISOString(),
    );
  });

  it('AC-ALR-11 a failed stop closes its own late risk', async () => {
    // The same rule from the other side: once the delivery has failed, being
    // late is no longer the thing to fix, so one event closes one alert and
    // opens another.
    const stopId = anId();
    const tripId = anId();
    const lateKey = dedupeKeyFor('LATE_RISK', { kind: 'stop', id: stopId });
    const failedKey = dedupeKeyFor('FAILED_STOP', { kind: 'stop', id: stopId });

    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId, lateRisk: 0.98, minutesLate: 10 },
      },
      at('07:40:00'),
    );
    const handled = await deliver(
      w,
      {
        type: ALERT_RAISED_BY.stopFailed,
        payload: {
          v: 1,
          tripId,
          stopId,
          orderId: anId(),
          outletId: w.kadawatha,
          outcome: 'OUTLET_CLOSED',
        },
      },
      at('07:45:00'),
    );

    expect(handled.raised).toEqual([failedKey]);
    expect(handled.resolved).toEqual([lateKey]);
    expect((await oneAlert(w, lateKey)).status).toBe('RESOLVED');
    expect((await oneAlert(w, failedKey)).status).toBe('OPEN');
  });
});
