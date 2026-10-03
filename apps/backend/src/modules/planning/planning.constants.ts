/**
 * The names planning shares with the rest of the system (specs/planning/spec.md,
 * Events and Log events). Audit actions carry the module; outbox event types
 * drop it, because consumers subscribe by domain event.
 */
export const PLANNING_AUDIT = {
  planCreated: 'planning.plan.created',
  planEdited: 'planning.plan.edited',
  softRuleOverridden: 'planning.plan.soft_rule_overridden',
  planPublished: 'planning.plan.published',
  engineRunCompleted: 'planning.engine.run_completed',
  deferralConfirmed: 'planning.deferral.confirmed',
  repeatSkipOverridden: 'planning.deferral.repeat_skip_overridden',
  orderSwapped: 'planning.order.swapped',
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

/** Outbox event types planning emits (specs/planning/spec.md, Events; docs/events.md). */
export const PLANNING_EVENTS = {
  planEdited: 'plan.edited',
  planPublished: 'plan.published',
  engineRunCompleted: 'plan.engine_run.completed',
  engineRunFailed: 'plan.engine_run.failed',
  deferralConfirmed: 'deferral.confirmed',
} as const;

/** Log events that are not also audit actions. */
export const PLANNING_LOGS = {
  engineRunFailed: 'planning.engine.run_failed',
} as const;
