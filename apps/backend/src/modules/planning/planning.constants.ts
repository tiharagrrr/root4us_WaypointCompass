/**
 * The names planning shares with the rest of the system (specs/planning/spec.md,
 * Events and Log events). Audit actions carry the module; outbox event types
 * drop it, because consumers subscribe by domain event.
 */
export const PLANNING_AUDIT = {
  tripReassigned: 'planning.trip.reassigned',
  tripResequenced: 'planning.trip.resequenced',
  tripCancelled: 'planning.trip.cancelled',
  stopDeferred: 'planning.stop.deferred',
  /**
   * A lifecycle move another module asked for, the way ordering records
   * `ordering.order.status_changed`: the row says planning's own table
   * changed, and the caller writes its own `execution.*` row for the use
   * case that caused it (AC-PLN-34).
   */
  tripStatusChanged: 'planning.trip.status_changed',
  stopStatusChanged: 'planning.stop.status_changed',
} as const;
