/**
 * The names execution shares with the rest of the system: its outbox events,
 * its audit actions, its log-only events and the few numbers the driver's
 * day is measured in.
 *
 * Audit actions are '<module>.<entity>.<past-tense verb>'; outbox event types
 * drop the module, because consumers subscribe by domain event
 * (specs/execution/spec.md, Events and Log events).
 */

/** Outbox event types (notifications, alerts and realtime key off these). */
export const EXECUTION_EVENTS = {
  tripStarted: 'trip.started',
  stopArrived: 'stop.arrived',
  /** DELIVERED and PARTIAL both land here; the payload carries the outcome. */
  stopCompleted: 'stop.completed',
  stopFailed: 'stop.failed',
  tripCompleted: 'trip.completed',
  tripCantRun: 'trip.cant_run',
  /**
   * The spec's Events table names the six above. Architecture rule 4 asks for
   * an outbox event on every state change, and `POST /trips/{id}/downloaded`
   * is one (it sets `downloadedAt`), so this completes the table the way
   * ordering completed its own for a draft's life.
   */
  tripDownloaded: 'trip.downloaded',
  /** 30 minutes with no ping or event on a running trip (AC-EXE-19). */
  vehicleOffline: 'vehicle.offline',
  /** The next ping after vehicle.offline. */
  vehicleBackOnline: 'vehicle.back_online',
} as const;

/** @OnTick names; the worker's ticker runs them once a minute. */
export const EXECUTION_TICKS = {
  signalWatch: 'execution.signal-watch',
} as const;

/** Audit actions and the log `event` field, which carry the module. */
export const EXECUTION_AUDIT = {
  tripDownloaded: 'execution.trip.downloaded',
  tripStarted: 'execution.trip.started',
  stopArrived: 'execution.stop.arrived',
  stopCompleted: 'execution.stop.completed',
  /** PARTIAL audits under its own action, carrying the outcome and the note. */
  stopPartial: 'execution.stop.partial',
  stopFailed: 'execution.stop.failed',
  tripCantRun: 'execution.trip.cant_run',
  tripCompleted: 'execution.trip.completed',
  attachmentPresigned: 'execution.attachment.presigned',
  attachmentUploaded: 'execution.attachment.uploaded',
  vehicleOffline: 'execution.vehicle.offline',
  vehicleBackOnline: 'execution.vehicle.back_online',
} as const;

/** Log-only events: no audit row, no outbox event. */
export const EXECUTION_LOGS = {
  /** Every applied field event, with its type and whether it synced late. */
  stopRecorded: 'execution.stop.recorded',
  /** A driver who arrived at a later stop before an earlier one (AC-EXE-08). */
  outOfSequence: 'execution.stop.out_of_sequence',
  /** A batch of pings: counts only, never coordinates. */
  pingsReceived: 'tracking.pings.received',
  positionNotPublished: 'tracking.position.not_published',
  vehicleOffline: 'tracking.vehicle.offline',
  vehicleBackOnline: 'tracking.vehicle.back_online',
} as const;

/** D10: how far back a driver's own trips go. */
export const MY_TRIPS_WINDOW_DAYS = 7;

/** An event received more than this many minutes after it happened synced late. */
export const LATE_SYNC_MINUTES = 5;

/** Proof-of-delivery URLs: 10 minutes to upload, 5 to download (AC-EXE-16). */
export const UPLOAD_URL_MINUTES = 10;
export const DOWNLOAD_URL_MINUTES = 5;

/**
 * The largest signature or photo a phone may send. The spec leaves the limit
 * open; 5 MB passes a full-page JPEG from a modern phone camera and is the
 * value this build decided on (specs/execution/spec.md, Open questions).
 */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
