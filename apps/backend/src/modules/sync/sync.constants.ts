/** Outbox events sync emits (specs/sync/spec.md, Events). */
export const SYNC_EVENTS = {
  batchApplied: 'sync.batch_applied',
} as const;

/** Log event keys; counts only, never a device's record. */
export const SYNC_LOGS = {
  batchApplied: 'sync.batch.applied',
  eventRefused: 'sync.event.refused',
} as const;

/** The protocol version a device sends in `x-sync-version`. */
export const SYNC_VERSION = '1';

/** The outbox event types `GET /sync/changes` hands a device (specs/sync/spec.md, Events). */
export const CHANGE_TYPES = [
  'plan.revised',
  'trip.reassigned',
  'trip.resequenced',
  'trip.cancelled',
  'stop.deferred',
  'load.flag_decided',
] as const;
