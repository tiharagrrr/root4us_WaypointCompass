import type { AlertType } from '@waypoint/shared';
import type { z } from 'zod';
import {
  ALERT_RAISED_BY,
  ALERT_RESOLVED_BY,
  type AlertSeverity,
  LOADER_SHORTFALL_CRITICAL_MINUTES,
} from '../alerts.constants';
import { catalogFor } from './catalog';
import { dedupeKeyFor } from './dedupe-key';
import {
  deferralConfirmedPayload,
  deferralRespondedPayload,
  etaUpdatedPayload,
  issueReportedPayload,
  issueResolvedPayload,
  loadFlagDecidedPayload,
  loadFlagRaisedPayload,
  stopCompletedPayload,
  stopDeferredPayload,
  stopFailedPayload,
  syncConflictPayload,
  tripCantRunPayload,
  tripPayload,
  vehicleSignalPayload,
} from './event-payloads';

/**
 * One outbox row as the relay hands it over. `depotId` is the row's routing
 * depot rather than a payload field, because that is where every producer
 * already puts it and `alerts.depotId` is required.
 */
export interface DomainEvent {
  /** The outbox_events id, which is also the listener's dedupe key. */
  id: string;
  type: string;
  depotId: string | null;
  payload: unknown;
  occurredAt: Date;
}

export interface RuleContext {
  now: Date;
  /** `tracking.lateRiskThreshold`: the probability that raises LATE_RISK. */
  lateRiskThreshold: number;
}

/** Raise this alert, or update it if its key already has an open one. */
export interface RaiseIntent {
  kind: 'raise';
  type: AlertType;
  dedupeKey: string;
  severity: AlertSeverity;
  title: string;
  detail: Record<string, unknown>;
  tripId: string | null;
  stopId: string | null;
  orderId: string | null;
  outletId: string | null;
  /** The person who reported it; null when a rule noticed it on its own. */
  raisedById: string | null;
}

/** Close the open alert for this key, because the fix it asked for happened. */
export interface ResolveIntent {
  kind: 'resolve';
  dedupeKey: string;
}

export type AlertIntent = RaiseIntent | ResolveIntent;

export interface RuleOutcome {
  intents: AlertIntent[];
  /** Set when alerts consumes this event but its payload did not parse. */
  unreadable?: string;
}

const NONE: RuleOutcome = { intents: [] };

/**
 * The map from events to alerts (specs/alerts/spec.md, Services and helpers).
 * Pure: the clock and the late-risk threshold come in as `ctx`, so the same
 * event always gives the same intents and the rules can be read as a table.
 *
 * An event may both raise and resolve. `stop.failed` raises FAILED_STOP and
 * at the same time clears that stop's LATE_RISK, because once the delivery
 * has failed, being late is no longer the thing to fix.
 *
 * Nothing here touches the database. The listener turns these intents into
 * rows, which is what makes "two late-risk updates for the same stop give
 * one alert" a property of the dedupe key rather than of the order the
 * relay happens to deliver in (AC-ALR-02).
 */
export const AlertRules = {
  forEvent(event: DomainEvent, ctx: RuleContext): RuleOutcome {
    switch (event.type) {
      case ALERT_RAISED_BY.etaUpdated:
        return lateRisk(event, ctx);
      case ALERT_RAISED_BY.stopFailed:
        return failedStop(event);
      case ALERT_RESOLVED_BY.stopCompleted:
        return on(event, stopCompletedPayload, (p) => [
          clear('LATE_RISK', 'stop', p.stopId),
        ]);
      case ALERT_RESOLVED_BY.stopDeferred:
        return on(event, stopDeferredPayload, (p) => [
          clear('LATE_RISK', 'stop', p.stopId),
          clear('FAILED_STOP', 'stop', p.stopId),
        ]);
      case ALERT_RAISED_BY.loadFlagRaised:
        return loaderShortfall(event, ctx);
      // A decided flag is settled, and so is one the loader undoes: nobody is left to decide
      // it (AC-ALR-13).
      case ALERT_RESOLVED_BY.loadFlagDecided:
      case ALERT_RESOLVED_BY.loadFlagResolved:
        return on(event, loadFlagDecidedPayload, (p) => [
          clear('LOADER_SHORTFALL', 'load_flag', p.flagId),
        ]);
      case ALERT_RAISED_BY.issueReported:
        return storeIssue(event);
      case ALERT_RESOLVED_BY.issueResolved:
        return on(event, issueResolvedPayload, (p) => [
          clear('STORE_ISSUE', 'issue', p.issueId),
        ]);
      case ALERT_RAISED_BY.tripCantRun:
        return cantRun(event);
      case ALERT_RESOLVED_BY.tripReassigned:
      case ALERT_RESOLVED_BY.tripCancelled:
        return on(event, tripPayload, (p) => [
          clear('DRIVER_CANT_RUN', 'trip', p.tripId),
        ]);
      case ALERT_RAISED_BY.vehicleOffline:
        return vehicleOffline(event);
      case ALERT_RESOLVED_BY.vehicleBackOnline:
        return on(event, vehicleSignalPayload, (p) => [
          clear('VEHICLE_OFFLINE', 'trip', p.tripId),
        ]);
      case ALERT_RAISED_BY.deferralStoreResponded:
        return priorityRequest(event);
      case ALERT_RESOLVED_BY.deferralConfirmed:
        return on(event, deferralConfirmedPayload, (p) => [
          clear('PRIORITY_REQUEST', 'deferral', p.deferralId),
          // A confirmed deferral is how a failed stop is answered when no
          // redelivery is planned; the spec names no redelivery event yet
          // (specs/alerts/spec.md, Open questions).
          ...(p.stopId ? [clear('FAILED_STOP', 'stop', p.stopId)] : []),
        ]);
      case ALERT_RAISED_BY.syncConflictDetected:
        return syncConflict(event);
      case ALERT_RESOLVED_BY.syncConflictResolved:
        return on(event, syncConflictPayload, (p) => [
          clear('SYNC_CONFLICT', 'sync_conflict', p.conflictId),
        ]);
      default:
        return NONE;
    }
  },

  /** Whether any rule reacts to this event type, for the listener's log. */
  consumes(type: string): boolean {
    return CONSUMED.has(type);
  },
};

const CONSUMED = new Set<string>([
  ...Object.values(ALERT_RAISED_BY),
  ...Object.values(ALERT_RESOLVED_BY),
]);

/**
 * LATE_RISK rises and falls with one number. Above the threshold the alert is
 * raised or its detail updated; below it, the alert closes itself.
 *
 * The spec's catalog says it clears when "the ETA is back inside the window",
 * but it is raised at a risk of 0.5, which is still ten minutes inside the
 * window, so the two readings disagree. This build clears on the threshold:
 * the same number raises and clears, which is the only reading that cannot
 * leave an alert open forever or flap around the window's edge (AC-ALR-03,
 * specs/alerts/spec.md, Open questions).
 */
function lateRisk(event: DomainEvent, ctx: RuleContext): RuleOutcome {
  return on(event, etaUpdatedPayload, (p) => {
    if (p.lateRisk < ctx.lateRiskThreshold)
      return [clear('LATE_RISK', 'stop', p.stopId)];
    const late = p.minutesLate ?? null;
    return [
      {
        kind: 'raise',
        type: 'LATE_RISK',
        dedupeKey: dedupeKeyFor('LATE_RISK', {
          kind: 'stop',
          id: p.stopId,
        }),
        severity: catalogFor('LATE_RISK').severity,
        title:
          late !== null && late > 0
            ? `Behind the delivery window by ${Math.round(late)} min`
            : 'At risk of missing the delivery window',
        detail: {
          lateRisk: p.lateRisk,
          threshold: ctx.lateRiskThreshold,
          minutesLate: late,
          etaAt: p.etaAt?.toISOString() ?? null,
        },
        tripId: p.tripId,
        stopId: p.stopId,
        orderId: p.orderId ?? null,
        outletId: p.outletId ?? null,
        raisedById: null,
      },
    ];
  });
}

function failedStop(event: DomainEvent): RuleOutcome {
  return on(event, stopFailedPayload, (p) => [
    {
      kind: 'raise',
      type: 'FAILED_STOP',
      dedupeKey: dedupeKeyFor('FAILED_STOP', { kind: 'stop', id: p.stopId }),
      severity: catalogFor('FAILED_STOP').severity,
      title: 'Delivery could not be completed',
      detail: { outcome: p.outcome },
      tripId: p.tripId,
      stopId: p.stopId,
      orderId: p.orderId,
      outletId: p.outletId,
      raisedById: null,
    },
    // The stop is not going to be late any more; it is not going to happen.
    clear('LATE_RISK', 'stop', p.stopId),
  ]);
}

/**
 * LOADER_SHORTFALL is critical when the trip it is on leaves within half an
 * hour, and a warning otherwise (AC-ALR-05). "The wave leaves" is read as the
 * trip's own planned departure, which is the time the dock works to; when the
 * event carries no departure, the alert stays a warning rather than guessing
 * at one (specs/alerts/spec.md, Open questions).
 */
function loaderShortfall(event: DomainEvent, ctx: RuleContext): RuleOutcome {
  return on(event, loadFlagRaisedPayload, (p) => {
    const minutes = p.plannedDepartAt
      ? (p.plannedDepartAt.getTime() - ctx.now.getTime()) / 60_000
      : null;
    const soon =
      minutes !== null && minutes <= LOADER_SHORTFALL_CRITICAL_MINUTES;
    return [
      {
        kind: 'raise',
        type: 'LOADER_SHORTFALL',
        dedupeKey: dedupeKeyFor('LOADER_SHORTFALL', {
          kind: 'load_flag',
          id: p.flagId,
        }),
        severity: soon ? 1 : catalogFor('LOADER_SHORTFALL').severity,
        title: soon
          ? 'Load shortfall on a trip about to leave'
          : 'Load shortfall flagged on the dock',
        detail: {
          reason: p.reason ?? null,
          plannedDepartAt: p.plannedDepartAt?.toISOString() ?? null,
          minutesToDeparture: minutes === null ? null : Math.round(minutes),
        },
        tripId: p.tripId,
        stopId: null,
        orderId: p.orderId ?? null,
        outletId: p.outletId ?? null,
        raisedById: null,
      },
    ];
  });
}

/**
 * A temperature issue is a warning; every other kind is information. The cold
 * chain is the only one that gets worse while the dispatcher reads the list
 * (AC-ALR-06).
 */
function storeIssue(event: DomainEvent): RuleOutcome {
  return on(event, issueReportedPayload, (p) => [
    {
      kind: 'raise',
      type: 'STORE_ISSUE',
      dedupeKey: dedupeKeyFor('STORE_ISSUE', { kind: 'issue', id: p.issueId }),
      severity:
        p.type === 'TEMPERATURE' ? 2 : catalogFor('STORE_ISSUE').severity,
      title:
        p.type === 'TEMPERATURE'
          ? 'Temperature issue reported by a store'
          : 'Delivery issue reported by a store',
      detail: { issueType: p.type },
      tripId: null,
      stopId: p.stopId ?? null,
      orderId: p.orderId ?? null,
      outletId: p.outletId,
      raisedById: p.raisedById ?? null,
    },
  ]);
}

function cantRun(event: DomainEvent): RuleOutcome {
  return on(event, tripCantRunPayload, (p) => [
    {
      kind: 'raise',
      type: 'DRIVER_CANT_RUN',
      dedupeKey: dedupeKeyFor('DRIVER_CANT_RUN', {
        kind: 'trip',
        id: p.tripId,
      }),
      severity: catalogFor('DRIVER_CANT_RUN').severity,
      title: 'Driver cannot run this trip',
      detail: {
        reason: p.reason ?? null,
        startedAlready: p.startedAlready ?? null,
      },
      tripId: p.tripId,
      stopId: null,
      orderId: null,
      outletId: null,
      // The driver reported it, so the panel can say who is waiting.
      raisedById: p.driverId ?? null,
    },
  ]);
}

function vehicleOffline(event: DomainEvent): RuleOutcome {
  return on(event, vehicleSignalPayload, (p) => [
    {
      kind: 'raise',
      type: 'VEHICLE_OFFLINE',
      dedupeKey: dedupeKeyFor('VEHICLE_OFFLINE', {
        kind: 'trip',
        id: p.tripId,
      }),
      severity: catalogFor('VEHICLE_OFFLINE').severity,
      title:
        p.minutesSilent === undefined
          ? 'No signal from the vehicle'
          : `No signal from the vehicle for ${Math.round(p.minutesSilent)} min`,
      detail: { minutesSilent: p.minutesSilent ?? null },
      tripId: p.tripId,
      stopId: null,
      orderId: null,
      outletId: null,
      raisedById: null,
    },
  ]);
}

/** Only a priority request raises; a plain acknowledgement is not a problem. */
function priorityRequest(event: DomainEvent): RuleOutcome {
  return on(event, deferralRespondedPayload, (p) => {
    if (!p.priorityRequested) return [];
    return [
      {
        kind: 'raise',
        type: 'PRIORITY_REQUEST',
        dedupeKey: dedupeKeyFor('PRIORITY_REQUEST', {
          kind: 'deferral',
          id: p.deferralId,
        }),
        severity: catalogFor('PRIORITY_REQUEST').severity,
        title: 'Store asked for priority on a deferred order',
        detail: { note: p.note ?? null },
        tripId: null,
        stopId: null,
        orderId: p.orderId ?? null,
        outletId: p.outletId ?? null,
        raisedById: p.respondedById ?? null,
      },
    ];
  });
}

function syncConflict(event: DomainEvent): RuleOutcome {
  return on(event, syncConflictPayload, (p) => [
    {
      kind: 'raise',
      type: 'SYNC_CONFLICT',
      dedupeKey: dedupeKeyFor('SYNC_CONFLICT', {
        kind: 'sync_conflict',
        id: p.conflictId,
      }),
      severity: catalogFor('SYNC_CONFLICT').severity,
      title: 'An offline record conflicts with the server',
      detail: { kind: p.kind ?? null },
      tripId: p.tripId ?? null,
      stopId: p.stopId ?? null,
      orderId: null,
      outletId: null,
      raisedById: null,
    },
  ]);
}

const clear = (
  type: AlertType,
  kind: Parameters<typeof dedupeKeyFor>[1]['kind'],
  id: string,
): ResolveIntent => ({
  kind: 'resolve',
  dedupeKey: dedupeKeyFor(type, { kind, id }),
});

/**
 * Parses the payload, then builds the intents. A payload that does not match
 * comes back as `unreadable` so the listener logs it and marks the event
 * handled: a producer's mistake must not stop the relay or hide the events
 * queued behind it.
 */
function on<S extends z.ZodTypeAny>(
  event: DomainEvent,
  schema: S,
  intents: (payload: z.infer<S>) => AlertIntent[],
): RuleOutcome {
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success)
    return { intents: [], unreadable: parsed.error.issues[0]?.message };
  return { intents: intents(parsed.data) };
}
