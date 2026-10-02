// The alerts module's public surface: other modules import from this file only.
export { AlertsModule } from './alerts.module';

/**
 * The one entry point for a delivered event. The outbox relay (ROO-24) calls
 * `handle(event)` once per row; everything else about an alert follows from
 * it. Nothing else in alerts is meant to be called from outside.
 */
export {
  AlertEventListener,
  type HandledEvent,
} from './services/alert-event.listener';
export type { DomainEvent } from './domain/alert-rules';

/** Reads, for a screen or module that needs the depot's alerts in process. */
export { AlertQueries } from './services/alert.queries';
export type { AlertRow } from './services/alerts.service';

export {
  ALERT_AUDIT,
  ALERT_EVENTS,
  ALERT_LOGS,
  ALERT_RAISED_BY,
  ALERT_RESOLVED_BY,
  type AlertSeverity,
} from './alerts.constants';
export { ALERT_CATALOG, type CatalogEntry } from './domain/catalog';
export {
  dedupeKeyFor,
  subjectOf,
  type AlertSubject,
} from './domain/dedupe-key';
export type {
  AlertAcknowledgedEvent,
  AlertEvent,
  AlertRaisedEvent,
  AlertResolvedEvent,
} from './events/alerts.events';
