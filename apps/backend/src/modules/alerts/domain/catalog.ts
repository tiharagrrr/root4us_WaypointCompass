import type { AlertType, Permission } from '@waypoint/shared';
import type { AlertSeverity } from '../alerts.constants';
import type { AlertSubject, AlertSubjectKind } from './dedupe-key';

/** The ids a fix link may be built from: the alert's columns and its subject. */
export interface FixContext {
  planId: string | null;
  tripId: string | null;
  stopId: string | null;
  orderId: string | null;
  subject: AlertSubject | null;
}

/**
 * One way to fix an alert: the relation the client looks for, the endpoint
 * that does it, and the permission that endpoint is guarded by.
 *
 * The permission is the whole point. An alert never blocks an action, so the
 * only thing a fix link decides is whether this viewer is offered the fix,
 * and the affordance rule (specs/api-conventions.md, section 2) says a link
 * may not promise what the server would refuse. Each `permission` below is
 * copied from the owning module's Endpoints table, so the two move together:
 * if planning re-guards `reassign`, this line is what has to change.
 */
export interface FixSpec {
  rel: string;
  /** The permission the fixing endpoint requires, from its module's spec. */
  permission: Permission;
  title: string;
  method?: 'GET' | 'POST';
  requires?: readonly string[];
  /** The path, or null when the alert carries no id to build it from. */
  href: (fix: FixContext) => string | null;
}

export interface CatalogEntry {
  type: AlertType;
  /** What the dedupe key names, so one episode is one alert. */
  subject: AlertSubjectKind;
  /** The severity unless a rule sharpens it from the event's facts. */
  severity: AlertSeverity;
  /**
   * What closes it, in words. The listener does the closing; this is here so
   * the catalog reads as the spec's table does and so 01 can say it.
   */
  resolvesWhen: string;
  fixes: readonly FixSpec[];
}

const api = (path: string) => `/api/v1${path}`;

/** The stop's own trip and id, which three of the fixes need together. */
const deferStop: FixSpec = {
  rel: 'defer',
  permission: 'deferral:decide',
  title: 'Defer this stop',
  method: 'POST',
  requires: ['reasonCode'],
  href: ({ tripId, stopId }) =>
    tripId && stopId ? api(`/trips/${tripId}/stops/${stopId}/defer`) : null,
};

/**
 * The alert catalog (specs/alerts/spec.md, Model). Eight types, each with the
 * severity it is raised at, the subject its dedupe key names, and the fixes
 * 01, 19 and 19a offer.
 *
 * Severities that depend on the event rather than the type are marked here
 * with the quieter value and sharpened in `AlertRules`: LOADER_SHORTFALL
 * turns critical when the trip leaves within half an hour, and STORE_ISSUE
 * when the issue is about temperature.
 */
export const ALERT_CATALOG: Readonly<Record<AlertType, CatalogEntry>> = {
  LATE_RISK: {
    type: 'LATE_RISK',
    subject: 'stop',
    severity: 2,
    resolvesWhen:
      'the late risk falls back under the threshold, or the stop is delivered, failed or deferred',
    fixes: [
      {
        rel: 'resequence',
        permission: 'trip:resequence',
        title: 'Re-sequence the run',
        method: 'POST',
        requires: ['If-Match', 'stopIds', 'reasonCode'],
        href: ({ tripId }) =>
          tripId ? api(`/trips/${tripId}/resequence`) : null,
      },
      deferStop,
    ],
  },
  FAILED_STOP: {
    type: 'FAILED_STOP',
    subject: 'stop',
    severity: 2,
    resolvesWhen: 'the stop is deferred or its deferral is confirmed',
    fixes: [deferStop],
  },
  LOADER_SHORTFALL: {
    type: 'LOADER_SHORTFALL',
    subject: 'load_flag',
    severity: 2,
    resolvesWhen: 'the flag is decided',
    fixes: [
      {
        rel: 'decide',
        permission: 'load:decide',
        title: 'Decide the flag',
        method: 'POST',
        requires: ['decision', 'reasonCode'],
        href: ({ subject }) =>
          subject?.kind === 'load_flag'
            ? api(`/load-flags/${subject.id}/decision`)
            : null,
      },
    ],
  },
  STORE_ISSUE: {
    type: 'STORE_ISSUE',
    subject: 'issue',
    severity: 3,
    resolvesWhen: 'the issue is resolved',
    fixes: [
      {
        rel: 'issue',
        permission: 'issue:read',
        title: 'Open the issue',
        href: ({ subject }) =>
          subject?.kind === 'issue' ? api(`/issues/${subject.id}`) : null,
      },
    ],
  },
  DRIVER_CANT_RUN: {
    type: 'DRIVER_CANT_RUN',
    subject: 'trip',
    severity: 1,
    resolvesWhen: 'the trip is reassigned or cancelled',
    fixes: [
      {
        rel: 'reassign',
        permission: 'trip:reassign',
        title: 'Reassign the trip',
        method: 'POST',
        requires: ['If-Match', 'reasonCode'],
        href: ({ tripId }) =>
          tripId ? api(`/trips/${tripId}/reassign`) : null,
      },
    ],
  },
  VEHICLE_OFFLINE: {
    type: 'VEHICLE_OFFLINE',
    subject: 'trip',
    severity: 2,
    resolvesWhen: 'the vehicle reports a position again',
    fixes: [
      {
        rel: 'tracking',
        permission: 'tracking:read',
        title: 'Open trip tracking',
        href: ({ tripId }) =>
          tripId ? api(`/trips/${tripId}/tracking`) : null,
      },
    ],
  },
  PRIORITY_REQUEST: {
    type: 'PRIORITY_REQUEST',
    subject: 'deferral',
    severity: 2,
    resolvesWhen: 'the deferral is confirmed',
    fixes: [
      {
        rel: 'deferral',
        permission: 'deferral:read',
        title: 'Open the deferral',
        href: ({ subject }) =>
          subject?.kind === 'deferral' ? api(`/deferrals/${subject.id}`) : null,
      },
    ],
  },
  SYNC_CONFLICT: {
    type: 'SYNC_CONFLICT',
    subject: 'sync_conflict',
    severity: 1,
    resolvesWhen: 'the conflict is resolved',
    fixes: [
      {
        rel: 'resolveConflict',
        permission: 'alert:act',
        title: 'Resolve the conflict',
        method: 'POST',
        requires: ['resolution', 'reasonCode'],
        href: ({ subject }) =>
          subject?.kind === 'sync_conflict'
            ? api(`/sync-conflicts/${subject.id}/resolve`)
            : null,
      },
    ],
  },
};

export const catalogFor = (type: AlertType): CatalogEntry =>
  ALERT_CATALOG[type];
