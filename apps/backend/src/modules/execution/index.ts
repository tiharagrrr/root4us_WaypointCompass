// The execution module's public surface: other modules import from this file only.
export { ExecutionModule } from './execution.module';

/** The one handler for a field event, online or replayed from the outbox. */
export {
  StopEventService,
  type AppliedEvent,
  type ApplyInput,
} from './services/stop-event.service';
export type { FieldEvent, FieldEventLine } from './domain/field-event';
export { isLateSync, isTripLevel } from './domain/field-event';
export {
  MyTripsQueries,
  type TripSummaryRow,
} from './services/my-trips.queries';
export {
  OfflineBundleService,
  type OfflineBundle,
} from './services/offline-bundle.service';
export {
  EXECUTION_AUDIT,
  EXECUTION_EVENTS,
  EXECUTION_LOGS,
} from './execution.constants';
export type {
  ExecutionEvent,
  StopArrivedEvent,
  StopCompletedEvent,
  StopFailedEvent,
  TripCantRunEvent,
  TripCompletedEvent,
  TripStartedEvent,
} from './events/execution.events';
export {
  TelematicsService,
  type PingInput,
  type PingResult,
  type PingSender,
} from './services/telematics.service';
export { SignalWatchService } from './services/signal-watch.service';
export { NO_SIGNAL_MINUTES } from './domain/pings';
export {
  PositionSimulator,
  whereNow,
} from './services/position-simulator.service';
