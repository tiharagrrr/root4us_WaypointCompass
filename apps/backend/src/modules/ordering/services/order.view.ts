import type { Brand, OrderStatus, TempClass } from '@waypoint/shared';
import type { orderLines, orders } from '../../../db/schema';
import type { OrderTotals } from '../domain/totals';

export type OrderRow = typeof orders.$inferSelect;
export type OrderLineRow = typeof orderLines.$inferSelect;

/** An order line with the item fields M1's table shows. */
export interface OrderLineView extends OrderLineRow {
  sku: string;
  name: string;
  packLabel: string;
}

/** The outlet's receiving window on the delivery day (M1's "Wed 30 Sep · 07:00–09:00"). */
export interface DeliveryWindow {
  openMin: number;
  open: string;
  closeMin: number;
  close: string;
}

/**
 * An order with everything a response needs that is not on the row: the
 * outlet's name, the cutoff instant M1 counts down to, the receiving window
 * and the totals with their line count. The query and the command services
 * both return this, so `OrderLinks` stays a pure mapping and never reads the
 * database (specs/api-conventions.md, section 2).
 */
export interface OrderView extends OrderRow {
  status: OrderStatus;
  brand: Brand;
  tempClass: TempClass;
  outlet: { id: string; name: string };
  /** The cutoff for this order's delivery date: edits and cancels close here. */
  editableUntil: Date;
  deliveryWindow: DeliveryWindow;
  totals: OrderTotals;
  /** Loaded only with ?include=lines or through the line endpoints. */
  lines?: OrderLineView[];
}
