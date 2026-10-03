import type { Excluded } from '../types';
import { outletOf, type AllocContext } from './context';
import { placeOrder, waitingOrder, type WaitingOrder } from './place';
import type { RankedOrder } from './priority';
import type { AllocPlan } from './state';

export interface PreScreened {
  /** Orders worth packing, in rank order. */
  queue: readonly RankedOrder[];
  /** Orders no vehicle could carry even on a trip of their own, with the rule that ruled each out. */
  refused: readonly WaitingOrder[];
  /** Orders that should never have reached the engine. Not deferrals: no reason, no store notice. */
  excluded: readonly Excluded[];
}

/**
 * Before anything is packed, ask of every order whether any available home-depot vehicle could carry
 * it at all: capacity, temperature, access, a trip of its own inside its window, and the budget and
 * fuel the vehicle has left. An order no vehicle could carry is settled now, so the packer is not
 * asked to find room that cannot exist, and the plan says UNAVOIDABLE with the rule that decided it.
 *
 * A Style order that is not due today is left out altogether. Ordering gives a Style order the
 * outlet's next delivery day, so this only fires when something upstream went wrong; it keeps
 * validate(allocate(x)) free of the HARD OPERATING_DAY violation such an order would cause.
 */
export function preScreen(ctx: AllocContext, plan: AllocPlan, ranked: readonly RankedOrder[]): PreScreened {
  const queue: RankedOrder[] = [];
  const refused: WaitingOrder[] = [];
  const excluded: Excluded[] = [];

  for (const entry of ranked) {
    const { order } = entry;
    const due = outletOf(ctx, order).styleDeliveryDow;
    if (order.brand === 'STYLE' && due !== null && due !== ctx.planDow) {
      excluded.push({
        orderId: order.id,
        code: 'NOT_DUE_TODAY',
        message: `${order.ref} is a Style order for day ${due}, not the plan's day ${ctx.planDow}`,
      });
      continue;
    }
    // The reefer preference is a packing choice, not a feasibility one: here a reefer counts as a
    // place an ambient order could go, so nothing is called unavoidable while a vehicle could take it.
    const outcome = placeOrder(ctx, plan, entry, { reeferForAmbient: true, dryRun: true });
    if (outcome.ok) queue.push(entry);
    else refused.push(waitingOrder(entry, outcome));
  }
  return { queue, refused, excluded };
}
