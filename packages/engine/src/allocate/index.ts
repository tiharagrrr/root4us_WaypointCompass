import { notAnOperatingDay } from '../rules/operating-day';
import type { EngineInput, EngineOutput, Excluded, Trip, TripDraft, Unplanned } from '../types';
import { validate } from '../validate';
import { compareText, stableSort } from '../util/stable-sort';
import { ENGINE_VERSION } from '../version';
import { measureTrip } from '../plan/measure';
import { allocContext, type AllocContext } from './context';
import { groupOrders } from './groups';
import { pack } from './pack';
import { preScreen } from './prescreen';
import { rankOrders, type RankedOrder } from './priority';
import { repair, type Waiting } from './repair';
import { unplannedOf } from './reasons';
import { withDepartMin } from './sequence';
import { statsOf } from './stats';
import { AllocPlan } from './state';

export interface AllocateOptions {
  /**
   * Keep the trips in `input.lockedTrips` exactly as they are — vehicle, trip number and stops — and
   * plan the rest of the day around them. This is what a re-run does for trips a dispatcher built or
   * edited by hand. Without it the engine ignores them and plans their orders again, which is the only
   * way a hand-built trip can be replaced.
   */
  keepLocked?: boolean;
}

const byKey = (a: Trip, b: Trip) => compareText(a.key, b.key);

/** The orders the run must not plan again: they already ride a trip it is keeping. */
function spokenFor(input: EngineInput, plan: AllocPlan): ReadonlyMap<string, true> {
  const taken = new Map<string, true>();
  for (const trip of input.fixedTrips) for (const id of trip.orderIds) taken.set(id, true);
  for (const planTrip of plan.planTrips()) for (const id of planTrip.trip.orderIds) taken.set(id, true);
  return taken;
}

function keepTrips(ctx: AllocContext, plan: AllocPlan, drafts: readonly TripDraft[], flag: 'locked' | 'reserved'): void {
  for (const draft of drafts) {
    plan.add(measureTrip(ctx.input, ctx.lookups, draft, `input.${flag}Trips`), { [flag]: true });
  }
}

/** The departure the schedule derives, pinned onto every trip, so the plan carries its own times. */
function pinDepartures(ctx: AllocContext, plan: AllocPlan): Trip[] {
  let all = plan.allTrips();
  for (const planTrip of plan.planTrips()) {
    const pinned = withDepartMin(ctx, all, planTrip.trip);
    plan.set(planTrip.key, pinned);
    all = all.map((trip) => (trip.key === pinned.key ? pinned : trip));
  }
  return stableSort(
    plan.planTrips().map((planTrip) => {
      const trip = planTrip.trip;
      if (planTrip.locked) return { ...trip, locked: true };
      return planTrip.reserved ? { ...trip, reserved: true } : trip;
    }),
    byKey,
  );
}

function allocateNothing(ctx: AllocContext, excluded: readonly Excluded[], violations: EngineOutput['violations']): EngineOutput {
  return {
    version: ENGINE_VERSION,
    date: ctx.input.date,
    trips: [],
    unplanned: [],
    excluded,
    violations,
    stats: statsOf(ctx, ctx.input.fixedTrips, [], [], excluded),
  };
}

/**
 * Builds the day's plan: pre-screen, rank, group, pack, sequence, repair, validate
 * (specs/engine/rules.md section 5).
 *
 * It is a deterministic greedy heuristic with a repair pass. Every rule that could block a placement
 * is asked before the order is placed, never only afterwards, so `validate(allocate(x))` holds no HARD
 * violation unless the input's own fixed or locked trips already broke one. Every order it cannot
 * place carries a reason, the rule behind it, the numbers and the repeat-skip flag.
 */
export function allocate(input: EngineInput, options: AllocateOptions = {}): EngineOutput {
  const ctx = allocContext(input);
  const plan = new AllocPlan(ctx, input.fixedTrips);

  // Nothing runs on a day the depot is closed. The orders are not deferrals: upstream should never
  // have queued them, and the API raises an alert for what comes back in excluded[].
  if (!input.isOperatingDay) {
    const excluded = stableSort(
      input.orders.map((order) => ({
        orderId: order.id,
        code: 'NOT_AN_OPERATING_DAY' as const,
        message: `${order.ref} is not planned: ${input.date} is not an operating day`,
      })),
      (a, b) => compareText(a.orderId, b.orderId),
    );
    return allocateNothing(ctx, excluded, [notAnOperatingDay(input.date)]);
  }

  if (options.keepLocked) keepTrips(ctx, plan, input.lockedTrips ?? [], 'locked');
  // A reservation holds a vehicle's capacity and trip slot, so the packer fills it before it opens
  // a new trip. One left empty keeps its slot.
  keepTrips(ctx, plan, input.reservedTrips ?? [], 'reserved');

  const taken = spokenFor(input, plan);
  const ranked = rankOrders(
    ctx,
    input.orders.filter((order) => !taken.has(order.id)),
  );
  const screened = preScreen(ctx, plan, ranked);
  const groups = groupOrders(ctx, screened.queue, (vehicleId) => plan.freeSlotCount(vehicleId));
  const pending = pack(ctx, plan, groups);
  const rankById = new Map<string, RankedOrder>(ranked.map((entry) => [entry.order.id, entry]));
  const waiting: Waiting[] = [
    ...screened.refused.map((refused) => ({ ...refused, choice: 'UNAVOIDABLE' as const })),
    ...repair(ctx, plan, pending, rankById),
  ];

  plan.dropEmptyUnreserved();
  const trips = pinDepartures(ctx, plan);
  const all = plan.allTrips();
  const unplanned: readonly Unplanned[] = stableSort(
    waiting.map((entry) => unplannedOf(ctx, all, entry)),
    (a, b) => compareText(a.orderId, b.orderId),
  );
  const excluded = stableSort(screened.excluded, (a, b) => compareText(a.orderId, b.orderId));

  return {
    version: ENGINE_VERSION,
    date: input.date,
    trips,
    unplanned,
    excluded,
    // Asked of every rule, not only the ones placement checks: a fixed or locked trip the input
    // brought in can carry a violation, and the plan says so instead of hiding it.
    violations: validate(input, { trips, unplanned }),
    stats: statsOf(ctx, all, trips, unplanned, excluded),
  };
}
