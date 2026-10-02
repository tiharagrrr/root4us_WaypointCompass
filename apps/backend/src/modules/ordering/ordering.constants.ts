/**
 * The names ordering shares with the rest of the system: its outbox events,
 * its audit actions, its log events, the notice codes a screen shows and the
 * tick handlers the worker runs once a minute.
 *
 * Audit actions are '<module>.<entity>.<past-tense verb>'; outbox event types
 * drop the module, because consumers subscribe by domain event
 * (specs/ordering/spec.md, Events and Log events).
 */

/** Outbox event types (`specs/notifications/spec.md` keys its templates on these). */
export const ORDER_EVENTS = {
  /**
   * Rule 4 asks for an outbox event on every state change, and the Build
   * Spec's catalog names only the five below the line. These three complete
   * it for a draft's life, so realtime can refresh M1 and 03 from the same
   * stream the rest of the module uses (see the spec's Events table).
   */
  created: 'order.created',
  updated: 'order.updated',
  deleted: 'order.deleted',
  linesChanged: 'order.lines_changed',
  templateCreated: 'order_template.created',
  templateDeleted: 'order_template.deleted',
  rosterReplaced: 'receiving_roster.replaced',

  submitted: 'order.submitted',
  rolledToNextRun: 'order.rolled_to_next_run',
  cancelled: 'order.cancelled',
  /** A load-check removal left part of an order behind (AC-LOD-12). */
  backordered: 'order.backordered',
  priorityChanged: 'order.priority_changed',
  cutoffClosed: 'order.cutoff_closed',
  /** The 15:30 nudge for an outlet with no order for tomorrow (AC-ORD-26). */
  cutoffReminder: 'order.cutoff_reminder',
} as const;

/** Audit actions and the log `event` field, which carry the module. */
export const ORDER_AUDIT = {
  created: 'ordering.order.created',
  updated: 'ordering.order.updated',
  linesChanged: 'ordering.order.lines_changed',
  submitted: 'ordering.order.submitted',
  cancelled: 'ordering.order.cancelled',
  confirmed: 'ordering.order.confirmed',
  priorityChanged: 'ordering.order.priority_changed',
  deleted: 'ordering.order.deleted',
  reordered: 'ordering.order.reordered',
  backordered: 'ordering.order.backordered',
  statusChanged: 'ordering.order.status_changed',
  templateSaved: 'ordering.order_template.created',
  templateRenamed: 'ordering.order_template.renamed',
  templateDeleted: 'ordering.order_template.deleted',
  rosterReplaced: 'ordering.receiving_roster.replaced',
  cutoffClosed: 'ordering.cutoff.closed',
} as const;

/** Log-only events (no audit row, no outbox event). */
export const ORDER_LOGS = {
  cutoffClosed: 'ordering.cutoff.closed',
  reminderSent: 'ordering.reminder.sent',
} as const;

/** meta.notices codes the screens key their copy on. */
export const ORDER_NOTICES = {
  /** M2: sent after the cutoff, so it goes on the next run. */
  rolledToNextRun: 'ORDER_ROLLED_TO_NEXT_RUN',
  /** M8's reorder left out items that have left the catalog (AC-ORD-07). */
  itemsLeftOut: 'REORDER_ITEMS_LEFT_OUT',
  /** A Style order waits for its outlet's weekly delivery day (AC-ORD-37). */
  styleDeliveryDay: 'ORDER_ON_WEEKLY_DELIVERY_DAY',
} as const;

/** @OnTick names; the worker's ticker runs both once a minute. */
export const ORDER_TICKS = {
  cutoff: 'ordering.cutoff',
  cutoffReminder: 'ordering.cutoff-reminder',
} as const;

/** Settings ordering reads (core/settings/settings.registry.ts). */
export const ORDER_SETTINGS = {
  cutoffMin: 'ordering.cutoffMin',
  cutoffReminderMin: 'ordering.cutoffReminderMin',
} as const;

/** Where an order came from (`orders.source`). */
export const ORDER_SOURCES = ['web', 'seed', 'reorder', 'backorder'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
