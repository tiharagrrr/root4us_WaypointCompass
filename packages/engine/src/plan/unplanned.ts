import type { EngineParams } from '../params';
import { priorityOf } from '../priority';
import type { EngineInput, EngineOrder, Plan, Unplanned } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { isRepeatSkip } from './repeat-skip';

/**
 * The orders that are on no trip: not on a trip in the plan, and not on a fixed (released or
 * in-progress) trip. This is the one definition of "unplanned". Sorted by id.
 */
export function unplannedOrders(input: EngineInput, plan: Plan): EngineOrder[] {
  const onATrip = new Set([...input.fixedTrips, ...plan.trips].flatMap((t) => t.orderIds));
  return stableSort(
    input.orders.filter((o) => !onATrip.has(o.id)),
    (a, b) => compareText(a.id, b.id),
  );
}

/** The entry for an order a dispatcher took off a trip: its priority and repeat-skip flag, no reason yet. */
export function manualUnplanned(input: EngineInput, order: EngineOrder, params: EngineParams): Unplanned {
  return {
    orderId: order.id,
    reasonCode: null,
    bindingRule: null,
    choice: null,
    priority: priorityOf(input, order, params),
    repeatSkip: isRepeatSkip(input.history[order.outletId], params),
  };
}
