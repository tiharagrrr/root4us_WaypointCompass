import type { AlertStatus, AlertType } from '@waypoint/shared';
import type { AlertSeverity } from '../alerts.constants';

/**
 * What alerts puts on the outbox, versioned so a consumer can tell the shapes
 * apart (specs/alerts/spec.md, Events). All three events carry the same
 * fields, because all three answer the same question for their consumers:
 * which alert, about what, and how bad.
 *
 * `severity` is here for notifications, which pushes severity 1 to the
 * depot's dispatchers, and `status` for realtime, so 01 and 19 can update the
 * row they already hold rather than refetch the list.
 *
 * Routing: `aggregate: ['alert', id]`, the alert's `depotId` and its
 * `outletId` when it has one, so a dispatcher's panel hears about their own
 * depot and nothing else.
 */
export interface AlertEvent {
  v: 1;
  alertId: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  depotId: string;
  /** The key the alert deduped on, so a consumer can group episodes. */
  dedupeKey: string;
  tripId: string | null;
  stopId: string | null;
  orderId: string | null;
  outletId: string | null;
  /** Set on alert.resolved when a person resolved it, null on auto-resolve. */
  resolvedById?: string | null;
}

export type AlertRaisedEvent = AlertEvent;
export type AlertAcknowledgedEvent = AlertEvent;
export type AlertResolvedEvent = AlertEvent;
