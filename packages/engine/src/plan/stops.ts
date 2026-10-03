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

/** The outlet window, narrowed by the mall window at a mall-dock outlet. */
export function effectiveWindow(outlet: EngineOutlet): { openMin: number; closeMin: number } {
  const mall =
    outlet.parkingConstraint === 'MALL_DOCK' &&
    outlet.mallWindowOpenMin !== null &&
    outlet.mallWindowCloseMin !== null;
  if (!mall) return { openMin: outlet.windowOpenMin, closeMin: outlet.windowCloseMin };
  return {
    openMin: Math.max(outlet.windowOpenMin, outlet.mallWindowOpenMin ?? 0),
    closeMin: Math.min(outlet.windowCloseMin, outlet.mallWindowCloseMin ?? 0),
  };
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
