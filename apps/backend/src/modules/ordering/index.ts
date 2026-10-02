// The ordering module's public surface: other modules import from this file only.
export { OrderingModule } from './ordering.module';

/** The one way another module moves an order's status (architecture rule 2). */
export { OrderLifecycleService } from './services/order-lifecycle.service';
/** The confirmed queue planning builds a day's plan from. */
export { OrderQueries } from './services/order.queries';
export { CutoffService, type RunTarget } from './services/cutoff.service';
export type {
  DeliveryWindow,
  OrderLineView,
  OrderRow,
  OrderView,
} from './services/order.view';
export { computeTotals, type OrderTotals } from './domain/totals';
export { orderNoFor, brandOfOrderNo } from './domain/order-number';
export {
  ORDER_EVENTS,
  ORDER_AUDIT,
  ORDER_NOTICES,
  ORDER_TICKS,
  ORDER_SOURCES,
  type OrderSource,
} from './ordering.constants';
export type {
  OrderCancelledEvent,
  OrderDraftEvent,
  OrderLinesChangedEvent,
  OrderCutoffClosedEvent,
  OrderCutoffReminderEvent,
  OrderPriorityChangedEvent,
  OrderRolledEvent,
  OrderStatusChangedEvent,
  OrderSubmittedEvent,
  OrderingEvent,
} from './events/ordering.events';
