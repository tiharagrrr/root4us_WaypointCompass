import { lte } from '../util/lte';
import type { AllocContext } from './context';
import type { OrderGroup } from './groups';
import { placeOrder, waitingOrder, type WaitingOrder } from './place';
import type { AllocPlan } from './state';

/**
 * Fills the plan group by group, scarcest group first, and inside a group in packing order. Every
 * order is checked against every rule before it is placed, so the plan is legal at each step.
 *
 * The reefer preference lives here, not in the rules. An ambient order waits for an ambient vehicle
 * while chilled orders still have a turn to come, unless it scores at least
 * `reeferAmbientMinPriority` and no ambient vehicle can take it. Once no chilled order is left to
 * place, spare reefers are open to ambient orders: holding them back would help nobody.
 */
export function pack(
  ctx: AllocContext,
  plan: AllocPlan,
  groups: readonly OrderGroup[],
): WaitingOrder[] {
  let chilledLeft = 0;
  for (const group of groups) if (group.tripClass === 'CHILLED') chilledLeft += group.orders.length;

  const pending: WaitingOrder[] = [];
  for (const group of groups) {
    for (const entry of group.orders) {
      const highPriority = lte(ctx.params.reeferAmbientMinPriority, entry.priority);
      const outcome = placeOrder(ctx, plan, entry, { reeferForAmbient: chilledLeft === 0 || highPriority });
      if (group.tripClass === 'CHILLED') chilledLeft -= 1;
      if (!outcome.ok) pending.push(waitingOrder(entry, outcome));
    }
  }
  return pending;
}
