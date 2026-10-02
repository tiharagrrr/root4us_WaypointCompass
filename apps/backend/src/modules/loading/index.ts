// The loading module's public surface: other modules import from this file only.
export { LoadingModule } from './loading.module';

/**
 * The one entry point for a delivered `plan.published`, `plan.revised` or
 * `trip.reassigned`. The outbox relay (ROO-24) calls `handle(event)` once per
 * row; everything about a load list follows from it (AC-LOD-01, AC-LOD-13,
 * AC-LOD-19).
 */
export {
  LoadListBuilder,
  type BuiltList,
  type HandledEvent,
} from './services/load-list-builder.service';
export type { DeliveredEvent } from './domain/event-payloads';

/**
 * What sync needs to apply a loader's queued actions (specs/loading/spec.md,
 * Services and helpers: "index.ts exports what sync needs to apply loader
 * events"). `POST /sync` hands over the loader events of a batch and gets a
 * result per `clientUuid` back; the checks, the audit rows and the
 * idempotency are the same as the online path's (AC-LOD-18).
 */
export { LoaderEventService } from './services/loader-event.service';
export {
  LOADER_EVENT_TYPES,
  type BatchResult,
  type BatchStatus,
  type LoaderEvent,
  type LoaderEventType,
} from './domain/loader-event';

/** Reads, for a screen or module that needs a dock's lists in process. */
export { LoadingQueries } from './services/loading.queries';
export type {
  LoadFlagRow,
  LoadLineRow,
  LoadLineView,
  LoadListView,
  LoadReleaseRow,
  LoadRun,
  LoadTripRow,
  LoadTripSummary,
} from './services/loading.queries';

export {
  LOAD_AUDIT,
  LOAD_CONSUMES,
  LOAD_EVENTS,
  LOAD_LOGS,
  LOAD_REJECTIONS,
  MAX_CHECK_BATCH,
} from './loading.constants';

export type {
  LoadFlagDecidedEvent,
  LoadFlagRaisedEvent,
  LoadFlagResolvedEvent,
  LoadLineCheckedEvent,
  LoadListUpdatedEvent,
  LoadingEvent,
  TripReleasedEvent,
} from './events/loading.events';

/** The last-stop-first rule itself, for a screen or a test that needs it. */
export {
  groupByStop,
  isFlagOpen,
  isOutstanding,
  loadOrder,
  statusAfterUndo,
  type LoadProgress,
} from './domain/load-order';
