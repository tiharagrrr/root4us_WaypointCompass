import type { AlertType } from '@waypoint/shared';
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
  alertRows,
  anId,
  auditRows,
  buildWorld,
  captureLogs,
  closeWorld,
  deliver,
  oneAlert,
  outboxRows,
  receiptCount,
  type CapturedLogs,
  type World,
} from './alerts.world';

/** 2026-10-02, the demo day, in Asia/Colombo. */
const at = (time: string) => `2026-10-02T${time}+05:30`;

describeWithDb('alerts: raising (ROO-50)', () => {
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

  it('AC-ALR-01 every catalog event raises its alert', async () => {
    // One row per line of the criterion's Examples table. Each id is fresh,
    // so the nine alerts are nine separate episodes rather than one another's
    // duplicates, and `plannedDepartAt` is 45 minutes out so the loader
    // shortfall lands on the warning side of its boundary.
    const ids = {
      stop: anId(),
      failedStop: anId(),
      flag: anId(),
      damaged: anId(),
      temperature: anId(),
      cantRun: anId(),
      offline: anId(),
      deferral: anId(),
      conflict: anId(),
    };
    const examples: {
      event: string;
      payload: Record<string, unknown>;
      alert: AlertType;
      severity: number;
      key: string;
    }[] = [
      {
        event: ALERT_RAISED_BY.etaUpdated,
        // 5 minutes of slack reads 0.73 on the late-risk curve (Step 6).
        payload: { v: 1, tripId: anId(), stopId: ids.stop, lateRisk: 0.73 },
        alert: 'LATE_RISK',
        severity: 2,
        key: dedupeKeyFor('LATE_RISK', { kind: 'stop', id: ids.stop }),
      },
      {
        event: ALERT_RAISED_BY.stopFailed,
        payload: {
          v: 1,
          tripId: anId(),
          stopId: ids.failedStop,
          orderId: anId(),
          outletId: w.kadawatha,
          outcome: 'OUTLET_CLOSED',
        },
        alert: 'FAILED_STOP',
        severity: 2,
        key: dedupeKeyFor('FAILED_STOP', { kind: 'stop', id: ids.failedStop }),
      },
      {
        event: ALERT_RAISED_BY.loadFlagRaised,
        payload: {
          v: 1,
          flagId: ids.flag,
          tripId: anId(),
          reason: 'MISSING',
          plannedDepartAt: at('05:35:00'),
        },
        alert: 'LOADER_SHORTFALL',
        severity: 2,
        key: dedupeKeyFor('LOADER_SHORTFALL', {
          kind: 'load_flag',
          id: ids.flag,
        }),
      },
      {
        event: ALERT_RAISED_BY.issueReported,
        payload: {
          v: 1,
          issueId: ids.damaged,
          type: 'DAMAGED',
          outletId: w.kadawatha,
        },
        alert: 'STORE_ISSUE',
        severity: 3,
        key: dedupeKeyFor('STORE_ISSUE', { kind: 'issue', id: ids.damaged }),
      },
      {
        event: ALERT_RAISED_BY.issueReported,
        payload: {
          v: 1,
          issueId: ids.temperature,
          type: 'TEMPERATURE',
          outletId: w.kadawatha,
        },
        alert: 'STORE_ISSUE',
        severity: 2,
        key: dedupeKeyFor('STORE_ISSUE', {
          kind: 'issue',
          id: ids.temperature,
        }),
      },
      {
        event: ALERT_RAISED_BY.tripCantRun,
        payload: { v: 1, tripId: ids.cantRun, reason: 'BREAKDOWN' },
        alert: 'DRIVER_CANT_RUN',
        severity: 1,
        key: dedupeKeyFor('DRIVER_CANT_RUN', { kind: 'trip', id: ids.cantRun }),
      },
      {
        event: ALERT_RAISED_BY.vehicleOffline,
        payload: { v: 1, tripId: ids.offline, minutesSilent: 31 },
        alert: 'VEHICLE_OFFLINE',
        severity: 2,
        key: dedupeKeyFor('VEHICLE_OFFLINE', { kind: 'trip', id: ids.offline }),
      },
      {
        event: ALERT_RAISED_BY.deferralStoreResponded,
        payload: {
          v: 1,
          deferralId: ids.deferral,
          priorityRequested: true,
          note: 'We open at 7 and need it first',
        },
        alert: 'PRIORITY_REQUEST',
        severity: 2,
        key: dedupeKeyFor('PRIORITY_REQUEST', {
          kind: 'deferral',
          id: ids.deferral,
        }),
      },
      {
        event: ALERT_RAISED_BY.syncConflictDetected,
        payload: { v: 1, conflictId: ids.conflict, kind: 'LATE_DELIVERY' },
        alert: 'SYNC_CONFLICT',
        severity: 1,
        key: dedupeKeyFor('SYNC_CONFLICT', {
          kind: 'sync_conflict',
          id: ids.conflict,
        }),
      },
    ];

    for (const example of examples) {
      await deliver(
        w,
        { type: example.event, payload: example.payload },
        at('04:50:00'),
      );

      const alert = await oneAlert(w, example.key);
      expect({
        type: alert.type,
        status: alert.status,
        severity: alert.severity,
        depotId: alert.depotId,
      }).toEqual({
        type: example.alert,
        status: 'OPEN',
        severity: example.severity,
        depotId: w.depot.plg,
      });

      // alert.raised once, and the audit row that goes with a new row.
      expect(await outboxRows(w, ALERT_EVENTS.raised, alert.id)).toHaveLength(
        1,
      );
      expect(await auditRows(w, ALERT_AUDIT.raised, alert.id)).toHaveLength(1);

      const logged = logs
        .withEvent(ALERT_LOGS.raised)
        .filter((line) => line.alertId === alert.id);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        type: example.alert,
        severity: example.severity,
      });
    }
  });

  it('AC-ALR-02 late risk dedupes per stop', async () => {
    const stopId = anId();
    const tripId = anId();
    const key = dedupeKeyFor('LATE_RISK', { kind: 'stop', id: stopId });

    // 5 minutes past the window's close reads 0.95, 10 minutes past it 0.98.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId, lateRisk: 0.95, minutesLate: 5 },
      },
      at('07:30:00'),
    );
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId, lateRisk: 0.98, minutesLate: 10 },
      },
      at('07:36:00'),
    );

    const alert = await oneAlert(w, key);
    expect(alert.status).toBe('OPEN');
    expect(alert.severity).toBe(2);
    // The detail holds the later update, and raisedAt still the first one:
    // this is one episode getting worse, not two problems.
    expect(alert.detail).toMatchObject({ lateRisk: 0.98, minutesLate: 10 });
    expect(alert.raisedAt.toISOString()).toBe(
      new Date(at('07:30:00')).toISOString(),
    );
    expect(await outboxRows(w, ALERT_EVENTS.raised, alert.id)).toHaveLength(1);

    // 15 minutes of slack reads 0.27, under the 0.5 threshold.
    const calmStop = anId();
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.etaUpdated,
        payload: { v: 1, tripId, stopId: calmStop, lateRisk: 0.27 },
      },
      at('07:36:00'),
    );
    expect(
      await alertRows(
        w,
        dedupeKeyFor('LATE_RISK', { kind: 'stop', id: calmStop }),
      ),
    ).toEqual([]);
  });

  it('AC-ALR-05 loader shortfall severity follows departure', async () => {
    const early = { flagId: anId(), tripId: anId() };
    const later = { flagId: anId(), tripId: anId() };
    const keyOf = (flagId: string) =>
      dedupeKeyFor('LOADER_SHORTFALL', { kind: 'load_flag', id: flagId });

    // The demo clock reads 04:50. DRY-31 leaves at 05:15, 25 minutes out.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.loadFlagRaised,
        payload: {
          v: 1,
          ...early,
          reason: 'MISSING',
          plannedDepartAt: at('05:15:00'),
        },
      },
      at('04:50:00'),
    );
    const critical = await oneAlert(w, keyOf(early.flagId));
    expect(critical.severity).toBe(1);
    // The push itself is notifications' work (specs/alerts/spec.md, Scope);
    // what alerts owes it is an event that says how bad this is.
    const [raised] = await outboxRows(w, ALERT_EVENTS.raised, critical.id);
    expect(raised.payload).toMatchObject({
      severity: 1,
      type: 'LOADER_SHORTFALL',
    });
    expect(raised.depotId).toBe(w.depot.plg);

    // The other trip leaves at 06:00, 70 minutes out.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.loadFlagRaised,
        payload: { v: 1, ...later, plannedDepartAt: at('06:00:00') },
      },
      at('04:50:00'),
    );
    expect((await oneAlert(w, keyOf(later.flagId))).severity).toBe(2);

    // Tihara decides the first flag REPLACE at 04:55.
    await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.loadFlagDecided,
        payload: { v: 1, flagId: early.flagId, tripId: early.tripId },
      },
      at('04:55:00'),
    );
    expect((await oneAlert(w, keyOf(early.flagId))).status).toBe('RESOLVED');
    expect((await oneAlert(w, keyOf(later.flagId))).status).toBe('OPEN');
  });

  it('AC-ALR-06 store issue severity and clearing', async () => {
    const temperature = anId();
    const damaged = anId();
    const keyOf = (issueId: string) =>
      dedupeKeyFor('STORE_ISSUE', { kind: 'issue', id: issueId });

    for (const [issueId, type] of [
      [temperature, 'TEMPERATURE'],
      [damaged, 'DAMAGED'],
    ] as const) {
      await deliver(
        w,
        {
          type: ALERT_RAISED_BY.issueReported,
          payload: {
            v: 1,
            issueId,
            type,
            outletId: w.kadawatha,
            raisedById: w.as.store.id,
          },
        },
        at('08:10:00'),
      );
    }
    expect((await oneAlert(w, keyOf(temperature))).severity).toBe(2);
    expect((await oneAlert(w, keyOf(damaged))).severity).toBe(3);

    // Each points at its own issue; the fix link is checked in the API suite,
    // where there is a viewer to render it for (AC-ALR-07).
    expect((await oneAlert(w, keyOf(damaged))).dedupeKey).toContain(damaged);

    await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.issueResolved,
        payload: { v: 1, issueId: damaged },
      },
      at('09:00:00'),
    );
    const closed = await oneAlert(w, keyOf(damaged));
    expect(closed.status).toBe('RESOLVED');
    expect(closed.resolvedById).toBeNull();
    expect((await oneAlert(w, keyOf(temperature))).status).toBe('OPEN');
  });

  it('AC-ALR-10 replays dedupe; a new episode opens a new alert', async () => {
    // The relay delivers event E twice. The second delivery must change
    // nothing at all, not even re-announce the alert.
    const stopId = anId();
    const failedKey = dedupeKeyFor('FAILED_STOP', { kind: 'stop', id: stopId });
    const eventId = anId();
    const failure = {
      id: eventId,
      type: ALERT_RAISED_BY.stopFailed,
      payload: {
        v: 1,
        tripId: anId(),
        stopId,
        orderId: anId(),
        outletId: w.kadawatha,
        outcome: 'REFUSED',
      },
    };

    const first = await deliver(w, failure, at('06:00:00'));
    expect(first.raised).toEqual([failedKey]);
    const again = await deliver(w, failure, at('06:00:00'));
    expect(again.replayed).toBe(true);

    const alert = await oneAlert(w, failedKey);
    expect(await outboxRows(w, ALERT_EVENTS.raised, alert.id)).toHaveLength(1);
    expect(await auditRows(w, ALERT_AUDIT.raised, alert.id)).toHaveLength(1);
    expect(await receiptCount(w, eventId)).toBe(1);

    // A vehicle goes quiet at 05:22 and reports again at 05:52.
    const tripId = anId();
    const offlineKey = dedupeKeyFor('VEHICLE_OFFLINE', {
      kind: 'trip',
      id: tripId,
    });
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.vehicleOffline,
        payload: { v: 1, tripId, minutesSilent: 31 },
      },
      at('05:22:00'),
    );
    await deliver(
      w,
      {
        type: ALERT_RESOLVED_BY.vehicleBackOnline,
        payload: { v: 1, tripId },
      },
      at('05:52:00'),
    );
    const resolved = await oneAlert(w, offlineKey);
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedById).toBeNull();
    expect(
      logs
        .withEvent(ALERT_LOGS.autoResolved)
        .filter((line) => line.alertId === resolved.id),
    ).toEqual([expect.objectContaining({ minutesOpen: 30 })]);

    // The same vehicle goes quiet again at 06:40. That is a new problem, and
    // the dedupe key is free again, so it gets its own row.
    await deliver(
      w,
      {
        type: ALERT_RAISED_BY.vehicleOffline,
        payload: { v: 1, tripId, minutesSilent: 31 },
      },
      at('06:40:00'),
    );
    const episodes = await alertRows(w, offlineKey);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((row) => row.status).sort()).toEqual([
      'OPEN',
      'RESOLVED',
    ]);
    const unchanged = episodes.find((row) => row.id === resolved.id);
    expect(unchanged).toEqual(resolved);
  });

  it('AC-ALR-12 a broken audit chain is not an alert', async () => {
    // The chain verify job (audit, ROO-23) publishes its mismatch, and
    // admins get a critical notification. Alerts consumes no audit event at
    // all, which is what makes "not an alert" true by construction rather
    // than by a rule someone could add back (specs/alerts/spec.md, Scope).
    const before = await alertRows(w);
    const handled = await deliver(
      w,
      {
        type: 'audit.chain.mismatch',
        payload: { v: 1, seq: 4747, expected: 'abc', found: 'def' },
      },
      at('03:00:00'),
    );

    expect(handled).toEqual({
      raised: [],
      refreshed: [],
      resolved: [],
      replayed: false,
    });
    expect(await alertRows(w)).toEqual(before);
  });
});
