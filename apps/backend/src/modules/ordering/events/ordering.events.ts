import type { OrderStatus, TempClass } from '@waypoint/shared';

/**
 * What ordering puts on the outbox, versioned so a consumer can tell the
 * shapes apart (specs/ordering/spec.md, Events). Every payload carries ids
 * and the few fields consumers need, never personal data.
 *
 * Routing: `aggregate: ['order', id]`, the order's `depotId`, and
 * `outletIds: [outletId]`, so realtime reaches 03 and the store's own
 * screens and notifications reach the right store manager.
 */

/**
 * order.created, order.updated and order.deleted: a draft's own life, which
 * realtime uses to refresh M1 and 03 from the same stream as everything else.
 */
export type OrderDraftEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  tempClass: TempClass;
  requestedDate: string;
  deliveryDate: string;
};

/** order.lines_changed: the totals M1's summary card redraws from. */
export type OrderLinesChangedEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  lines: number;
  units: number;
};

/** order.submitted: notifications confirm to the store, realtime refreshes 03. */
export type OrderSubmittedEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  afterCutoff: boolean;
  deliveryDate: string;
};

/** order.rolled_to_next_run: M2's notice, sent beside order.submitted. */
export type OrderRolledEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  requestedDate: string;
  deliveryDate: string;
  reason: 'AFTER_CUTOFF' | 'WEEKLY_DELIVERY_DAY';
};

/** order.cancelled: realtime, and planning drops it from a draft plan. */
export type OrderCancelledEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  deliveryDate: string;
  cancelledBy: 'store' | 'dispatcher';
  reasonCode: string | null;
};

/** order.priority_changed: planning re-ranks the order in a draft plan. */
export type OrderPriorityChangedEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  deliveryDate: string;
  urgent: boolean;
};

/** order.cutoff_closed: once per depot and date, however the cutoff closed. */
export type OrderCutoffClosedEvent = {
  v: 1;
  depotId: string;
  deliveryDate: string;
  confirmed: number;
  closedBy: 'ticker' | 'demo';
};

/** order.cutoff_reminder: the 15:30 nudge for an outlet with no order. */
export type OrderCutoffReminderEvent = {
  v: 1;
  outletId: string;
  depotId: string;
  deliveryDate: string;
  cutoffAt: string;
};

/** A lifecycle move another module asked for (planning, loading, execution, receipt). */
export type OrderStatusChangedEvent = {
  v: 1;
  orderId: string;
  outletId: string;
  from: OrderStatus;
  to: OrderStatus;
  tempClass: TempClass;
  deliveryDate: string;
};

export type OrderingEvent =
  | OrderDraftEvent
  | OrderLinesChangedEvent
  | OrderSubmittedEvent
  | OrderRolledEvent
  | OrderCancelledEvent
  | OrderPriorityChangedEvent
  | OrderCutoffClosedEvent
  | OrderCutoffReminderEvent
  | OrderStatusChangedEvent;
