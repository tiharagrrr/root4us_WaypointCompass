/**
 * The names alerts shares with the rest of the system: the events it emits,
 * the events it consumes to raise and resolve, its audit actions and its
 * log-only events (specs/alerts/spec.md, Events and Log events).
 *
 * Audit actions are '<module>.<entity>.<past-tense verb>'; outbox event types
 * drop the module, because consumers subscribe by domain event.
 */

/** Outbox event types realtime and notifications key off. */
export const ALERT_EVENTS = {
  raised: 'alert.raised',
  acknowledged: 'alert.acknowledged',
  resolved: 'alert.resolved',
} as const;

/** Audit actions and the log `event` field, which carry the module. */
export const ALERT_AUDIT = {
  raised: 'alerts.alert.raised',
  acknowledged: 'alerts.alert.acknowledged',
  resolved: 'alerts.alert.resolved',
  autoResolved: 'alerts.alert.auto_resolved',
} as const;

/** Log-only events: no audit row, no outbox event. */
export const ALERT_LOGS = {
  raised: 'alerts.alert.raised',
  autoResolved: 'alerts.alert.auto_resolved',
  /** An event the rules know, whose payload did not match its schema. */
  eventUnreadable: 'alerts.event.unreadable',
  /** A redelivery the receipts table caught before it raised anything. */
  eventReplayed: 'alerts.event.replayed',
} as const;

/**
 * Every event the listeners consume (specs/alerts/spec.md, Events). Alerts
 * depends on no other module, so these are names on the wire rather than
 * imported constants: the relay hands over an outbox row, and `AlertRules`
 * parses its payload with zod before trusting a field.
 */
export const ALERT_RAISED_BY = {
  etaUpdated: 'eta.updated',
  stopFailed: 'stop.failed',
  loadFlagRaised: 'load.flag_raised',
  issueReported: 'issue.reported',
  tripCantRun: 'trip.cant_run',
  vehicleOffline: 'vehicle.offline',
  deferralStoreResponded: 'deferral.store_responded',
  syncConflictDetected: 'sync.conflict_detected',
} as const;

export const ALERT_RESOLVED_BY = {
  etaUpdated: 'eta.updated',
  stopCompleted: 'stop.completed',
  stopFailed: 'stop.failed',
  stopDeferred: 'stop.deferred',
  deferralConfirmed: 'deferral.confirmed',
  loadFlagDecided: 'load.flag_decided',
  issueResolved: 'issue.resolved',
  tripReassigned: 'trip.reassigned',
  tripCancelled: 'trip.cancelled',
  vehicleBackOnline: 'vehicle.back_online',
  syncConflictResolved: 'sync.conflict_resolved',
} as const;

/**
 * A loader shortfall on a trip leaving within this many minutes is critical
 * (severity 1) rather than a warning. Exactly 30 minutes is critical: the
 * spec left the boundary open and this build chose the inclusive reading,
 * because the dispatcher has less time than the number suggests once the
 * flag reaches the panel (specs/alerts/spec.md, Open questions).
 */
export const LOADER_SHORTFALL_CRITICAL_MINUTES = 30;

/** Severity 1 is critical, 2 a warning, 3 information. */
export type AlertSeverity = 1 | 2 | 3;

/** Severity at or above which the depot's dispatchers are pushed to. */
export const PUSH_SEVERITY: AlertSeverity = 1;
