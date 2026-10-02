/**
 * The names loading shares with the rest of the system: the events it emits,
 * the events it consumes to build and refresh load lists, its audit actions
 * and its log-only events (specs/loading/spec.md, Events and Log events).
 *
 * Audit actions are '<module>.<entity>.<past-tense verb>'; outbox event types
 * drop the module, because consumers subscribe by domain event.
 */

/** Outbox event types realtime, alerts and notifications key off. */
export const LOAD_EVENTS = {
  /** A trip's list was built or refreshed: the Plan updated banner on L2. */
  listUpdated: 'load.list_updated',
  flagRaised: 'load.flag_raised',
  flagDecided: 'load.flag_decided',
  flagResolved: 'load.flag_resolved',
  /**
   * Architecture rule 4 asks for an outbox event on every state change, and
   * the spec's Events table names none for a check (its own Open questions
   * flag the gap). These two complete it, so realtime can move a tick onto
   * another loader's tablet on the same shared dock without re-reading the
   * list (specs/loading/spec.md, Open questions).
   */
  lineChecked: 'load.line_checked',
  lineCheckUndone: 'load.line_check_undone',
  tripReleased: 'trip.released',
} as const;

/** Audit actions and the log `event` field, which carry the module. */
export const LOAD_AUDIT = {
  listBuilt: 'loading.list.built',
  lineChecked: 'loading.line.checked',
  lineCheckUndone: 'loading.line.check_undone',
  flagRaised: 'loading.flag.raised',
  flagUndone: 'loading.flag.undone',
  flagDecided: 'loading.flag.decided',
  flagRechecked: 'loading.flag.rechecked',
  tripReleased: 'loading.trip.released',
} as const;

/** Log-only events: no audit row, no outbox event. */
export const LOAD_LOGS = {
  listBuilt: 'loading.list.built',
  flagRaised: 'loading.flag.raised',
  flagDecided: 'loading.flag.decided',
  tripReleased: 'loading.trip.released',
  /** An event the builder knows, whose payload did not match its schema. */
  eventUnreadable: 'loading.event.unreadable',
  /** A redelivery the receipts table caught before it rebuilt anything. */
  eventReplayed: 'loading.event.replayed',
} as const;

/**
 * The events LoadListBuilder consumes (specs/loading/spec.md, Events).
 * Loading does not import planning's event types for these: the relay hands
 * over an outbox row and `domain/event-payloads.ts` parses it with zod before
 * a field is trusted, the way alerts does.
 */
export const LOAD_CONSUMES = {
  planPublished: 'plan.published',
  planRevised: 'plan.revised',
  tripReassigned: 'trip.reassigned',
} as const;

/**
 * Why a batch item was rejected. A batch never fails as a whole because of
 * one bad item (specs/api-conventions.md, section 3), so these codes travel
 * in the per-item result instead of a problem document.
 */
export const LOAD_REJECTIONS = {
  /**
   * A check below `qtyExpected` with no flag on the line. The spec's Open
   * questions leave the code open; this one names what the loader has to do
   * about it, which is raise the flag (AC-LOD-05).
   */
  shortWithoutFlag: 'SHORT_WITHOUT_FLAG',
  /** The line is not on this trip, or not in the caller's scope. */
  lineNotFound: 'LINE_NOT_FOUND',
  /** The line's status has no CHECK in it: already removed, or the trip is out. */
  lineNotCheckable: 'LINE_NOT_CHECKABLE',
  /** More than `qtyExpected`: the extra is somebody else's order. */
  overExpected: 'OVER_EXPECTED',
  /** The trip has been released; the list is closed (AC-LOD-06). */
  tripClosed: 'TRIP_CLOSED',
} as const;

/** How many checks one batch may carry, as POST /sync allows (Non-functional). */
export const MAX_CHECK_BATCH = 100;
