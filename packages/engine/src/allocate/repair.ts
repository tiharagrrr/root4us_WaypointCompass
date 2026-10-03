import type { DeferralChoice } from '../rules/codes';
import type { TriedVehicle } from '../types';
import { lte } from '../util/lte';
import { compareText, stableSort } from '../util/stable-sort';
import type { AllocContext } from './context';
import { fits, type FitFailure } from './fits';
import { candidateVehicles, MoveBudget, placeOrder, type WaitingOrder } from './place';
import { compareRank, type RankedOrder } from './priority';
import type { AllocPlan } from './state';

/** An order still without a place once repair has had its turn, and why it is without one. */
export interface Waiting {
  ranked: RankedOrder;
  tried: readonly TriedVehicle[];
  lastFailure: FitFailure | null;
  choice: DeferralChoice;
  displacedBy?: string;
}

interface Attempt extends Waiting {
  placed: boolean;
}

/**
 * Pushes a lower-priority order off a trip to make room for this one. Only an order that scores
 * strictly less may be pushed, lowest score first, which is what keeps an outlet skipped on the last
 * run (worth 40 on its own) from being skipped again for something less pressing.
 *
 * The order pushed off is put back in the queue, so it is really a swap only when nothing else can
 * take it; otherwise it is a move between trips of the same group.
 */
function swapIn(
  ctx: AllocContext,
  plan: AllocPlan,
  waiting: Attempt,
  budget: MoveBudget,
  rankById: ReadonlyMap<string, RankedOrder>,
): Attempt | null {
  const { order } = waiting.ranked;
  const eligible = new Map(candidateVehicles(ctx, order).map((v) => [v.id, v]));
  const trips = plan
    .openTrips()
    .filter((t) => eligible.has(t.vehicleId) && t.brand === order.brand && t.districtId === order.districtId);

  for (const planTrip of stableSort(trips, (a, b) => compareText(a.key, b.key))) {
    const occupants = stableSort(
      planTrip.trip.orderIds.flatMap((id) => {
        const ranked = rankById.get(id);
        return ranked ? [ranked] : [];
      }),
      (a, b) => a.priority - b.priority || compareText(a.order.ref, b.order.ref),
    );
    for (const occupant of occupants) {
      // Strictly lower: equal scores never displace each other, so the result cannot depend on order.
      if (lte(waiting.ranked.priority, occupant.priority)) continue;
      if (!budget.spend()) return null;
      const orderIds = [
        ...planTrip.trip.orderIds.filter((id) => id !== occupant.order.id),
        order.id,
      ];
      const result = fits(ctx, plan.allTrips(), planTrip.trip, orderIds);
      if (!result.ok) continue;
      plan.set(planTrip.key, result.trip);
      return {
        ranked: occupant,
        tried: [],
        lastFailure: null,
        choice: 'PRIORITY_CHOICE',
        displacedBy: order.id,
        placed: false,
      };
    }
  }
  return null;
}

/**
 * The last pass over the orders the packer could not place: try again now that the plan is fuller (a
 * vehicle may have budget for a second trip), then try to make room by displacing a lower-priority
 * order. It stops after `improveIterations` placements, so a hard instance still ends in a plan, and
 * after the same number every time rather than on a wall-clock limit.
 */
export function repair(
  ctx: AllocContext,
  plan: AllocPlan,
  pending: readonly WaitingOrder[],
  rankById: ReadonlyMap<string, RankedOrder>,
): Waiting[] {
  const budget = new MoveBudget(ctx.params.improveIterations);
  const queue: Attempt[] = stableSort(pending, (a, b) => compareRank(a.ranked, b.ranked)).map((w) => ({
    ...w,
    choice: 'UNAVOIDABLE',
    placed: false,
  }));

  // A displaced order joins the end of the queue and gets its own turn, so a swap that strands
  // nobody costs nothing.
  for (let i = 0; i < queue.length; i += 1) {
    const waiting = queue[i];
    if (!waiting || budget.spent) break;
    const placed = placeOrder(ctx, plan, waiting.ranked, { reeferForAmbient: true, budget });
    if (placed.ok) {
      waiting.placed = true;
      continue;
    }
    if (placed.tried.length > 0) waiting.tried = placed.tried;
    if (placed.lastFailure) waiting.lastFailure = placed.lastFailure;
    const displaced = swapIn(ctx, plan, waiting, budget, rankById);
    if (displaced) {
      waiting.placed = true;
      queue.push(displaced);
    }
  }

  return queue.filter((w) => !w.placed).map(({ placed: _placed, ...rest }) => rest);
}
