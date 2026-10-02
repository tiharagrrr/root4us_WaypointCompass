import { allowanceMinutes } from '../time/trip-minutes';
import { effectiveWindow } from './window';
import type { EngineOrder, EngineOutlet, RuleContext, Trip } from '../types';

export interface Stop {
  order: EngineOrder;
  outlet: EngineOutlet;
  allowanceMin: number;
  /** The outlet window, narrowed by the mall window at a mall-dock outlet. */
  effectiveOpenMin: number;
  effectiveCloseMin: number;
}

/**
 * The trip's stops in visiting order. Orders the input does not describe (a released trip's orders
 * in repair mode) are skipped; they were checked when the trip was released.
 */
export function stopsOf(ctx: RuleContext, trip: Trip): Stop[] {
  const stops: Stop[] = [];
  for (const id of trip.orderIds) {
    const order = ctx.orderById.get(id);
    const outlet = order ? ctx.input.outlets[order.outletId] : undefined;
    if (!order || !outlet) continue;
    const window = effectiveWindow(outlet);
    stops.push({
      order,
      outlet,
      allowanceMin: allowanceMinutes(ctx.input.allowances, trip.brand, outlet.dockType),
      effectiveOpenMin: window.openMin,
      effectiveCloseMin: window.closeMin,
    });
  }
  return stops;
}
