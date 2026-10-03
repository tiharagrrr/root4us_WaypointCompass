import { budgetUse } from '../time/budget';
import type { EngineOrder, EngineVehicle, Trip, TriedVehicle } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { outletOf, type AllocContext } from './context';
import { fits, vehicleOf, type FitFailure } from './fits';
import type { RankedOrder } from './priority';
import type { AllocPlan, PlanTrip } from './state';

/**
 * How many placements the pass may still evaluate. The repair pass stops when it runs out, so a hard
 * instance ends in a plan rather than running on, and it stops after the same number of moves every
 * time rather than after a wall-clock limit.
 */
export class MoveBudget {
  constructor(private left: number) {}

  spend(): boolean {
    if (this.left <= 0) return false;
    this.left -= 1;
    return true;
  }

  get spent(): boolean {
    return this.left <= 0;
  }
}

export interface PlaceSuccess {
  ok: true;
  tripKey: string;
}

export interface PlaceFailure {
  ok: false;
  /** One entry per vehicle tried, in the order they were tried, with the rule that ruled it out. */
  tried: readonly TriedVehicle[];
  /** The last candidate's failure: the deferral's binding rule. */
  lastFailure: FitFailure | null;
}

export type PlaceOutcome = PlaceSuccess | PlaceFailure;

/** An order with no place yet, and what the last attempt to find it one came up against. */
export interface WaitingOrder {
  ranked: RankedOrder;
  tried: readonly TriedVehicle[];
  lastFailure: FitFailure | null;
}

export function waitingOrder(ranked: RankedOrder, failure: PlaceFailure): WaitingOrder {
  return { ranked, tried: failure.tried, lastFailure: failure.lastFailure };
}

export interface PlaceOptions {
  /**
   * Whether a reefer may take an ambient order now: either a high-priority ambient order has no
   * ambient vehicle that can take it, or every chilled order has had its turn and reefers are spare
   * (specs/engine/rules.md, TEMP_REEFER).
   */
  reeferForAmbient: boolean;
  budget?: MoveBudget;
  /** Ask only whether the order could be placed; the plan is left alone. Used by the pre-screen. */
  dryRun?: boolean;
}

/** A vehicle the order prefers: a reefer for chilled, an ambient vehicle for ambient. */
function isPreferred(order: EngineOrder, vehicle: EngineVehicle): boolean {
  return order.tempClass === 'CHILLED' ? vehicle.temp === 'REEFER' : vehicle.temp === 'AMBIENT';
}

/** Minutes left in the brand's budget for this vehicle, fixed trips counted. */
function budgetLeftMin(ctx: AllocContext, plan: AllocPlan, vehicle: EngineVehicle, order: EngineOrder): number {
  const trips = plan.allTrips().filter((t) => t.vehicleId === vehicle.id);
  const used = budgetUse(trips);
  return order.brand === 'FRESH'
    ? ctx.params.freshBudgetMin - used.freshMinutes
    : ctx.params.styleTechBudgetMin - used.styleTechMinutes;
}

/** How full the trip would be after taking the order, in its tightest dimension. */
function tightnessAfter(ctx: AllocContext, planTrip: PlanTrip, order: EngineOrder): number {
  const vehicle = vehicleOf(ctx, planTrip.vehicleId);
  return Math.max(
    (planTrip.trip.weightKg + order.weightKg) / vehicle.weightCapKg,
    (planTrip.trip.volumeM3 + order.volumeM3) / vehicle.volumeCapM3,
  );
}

/** The vehicles that could take this order at all: available, and based at its outlet's depot. */
export function candidateVehicles(ctx: AllocContext, order: EngineOrder): EngineVehicle[] {
  const depotId = outletOf(ctx, order).depotId;
  return stableSort(
    ctx.input.vehicles.filter((v) => v.available && v.depotId === depotId),
    (a, b) => compareText(a.code, b.code),
  );
}

/** A trip the order could join, or a new trip on a vehicle, in the order they are tried. */
type Candidate =
  | { kind: 'TRIP'; planTrip: PlanTrip; vehicleId: string }
  | { kind: 'NEW'; vehicleId: string; tripNo: number };

function candidatesFor(
  ctx: AllocContext,
  plan: AllocPlan,
  order: EngineOrder,
  vehicles: readonly EngineVehicle[],
): Candidate[] {
  const ids = new Map(vehicles.map((v) => [v.id, v]));
  // Open trips of the same brand and district. A reservation is filled before a new trip opens;
  // after that the fullest trip that still has room wins, so slack is not scattered.
  const open = plan
    .openTrips()
    .filter((t) => ids.has(t.vehicleId) && t.brand === order.brand && t.districtId === order.districtId);
  const trips = stableSort(open, (a, b) => {
    if (a.reserved !== b.reserved) return a.reserved ? -1 : 1;
    return tightnessAfter(ctx, b, order) - tightnessAfter(ctx, a, order) || compareText(a.key, b.key);
  }).map((planTrip): Candidate => ({ kind: 'TRIP', planTrip, vehicleId: planTrip.vehicleId }));

  // Then a new trip, on the vehicle with the most budget and capacity left.
  const fresh = stableSort(
    vehicles.filter((v) => plan.freeSlot(v.id) !== null),
    (a, b) =>
      budgetLeftMin(ctx, plan, b, order) - budgetLeftMin(ctx, plan, a, order) ||
      b.volumeCapM3 - a.volumeCapM3 ||
      b.weightCapKg - a.weightCapKg ||
      compareText(a.code, b.code),
  ).flatMap((v): Candidate[] => {
    const tripNo = plan.freeSlot(v.id);
    return tripNo === null ? [] : [{ kind: 'NEW', vehicleId: v.id, tripNo }];
  });

  return [...trips, ...fresh];
}

/**
 * Puts one order on a trip, checking every rule that could block it first. Candidates are tried from
 * the most suitable vehicle to the least, so the last failure is the telling one: for a chilled order
 * with no reefer left that is TEMP_REEFER, which reads as "no reefer capacity".
 *
 * Nothing is placed unless `fits` says the whole trip is legal, so a HARD violation cannot reach the
 * plan in the first place.
 */
export function placeOrder(
  ctx: AllocContext,
  plan: AllocPlan,
  ranked: RankedOrder,
  options: PlaceOptions,
): PlaceOutcome {
  const { order } = ranked;
  const all = candidateVehicles(ctx, order);
  const preferred = all.filter((v) => isPreferred(order, v));
  const rest = all.filter((v) => !isPreferred(order, v));
  // The preferred vehicles are always acceptable. The rest are only a real option for an ambient
  // order the preference now lets onto a reefer; a chilled order can never ride a non-reefer, so
  // trying those only collects the reason it waits.
  const passes: { vehicles: EngineVehicle[]; accept: boolean }[] = [
    { vehicles: preferred, accept: true },
    { vehicles: rest, accept: order.tempClass === 'AMBIENT' && options.reeferForAmbient },
  ];

  const tried: TriedVehicle[] = [];
  const seen = new Map<string, true>();
  let lastFailure: FitFailure | null = null;

  for (const pass of passes) {
    if (pass.vehicles.length === 0) continue;
    for (const candidate of candidatesFor(ctx, plan, order, pass.vehicles)) {
      // Out of moves: the caller sees it on the budget and stops the pass.
      if (options.budget && !options.budget.spend()) return { ok: false, tried, lastFailure };
      const current = plan.allTrips();
      const draft =
        candidate.kind === 'TRIP'
          ? candidate.planTrip.trip
          : plan.draftTrip(candidate.vehicleId, candidate.tripNo, order.brand, order.districtId);
      const orderIds =
        candidate.kind === 'TRIP' ? [...candidate.planTrip.trip.orderIds, order.id] : [order.id];
      const result = fits(ctx, current, draft, orderIds);
      if (!result.ok) {
        // Only a rule that can be a deferral's reason is worth remembering: DEPOT_HOME and the
        // structural rules say nothing a store could be told.
        if (result.bindingRule !== null) lastFailure = result;
        if (result.bindingRule !== null && !seen.has(candidate.vehicleId)) {
          seen.set(candidate.vehicleId, true);
          tried.push({ vehicleId: candidate.vehicleId, failedRule: result.bindingRule });
        }
        continue;
      }
      if (!pass.accept) continue;
      if (options.dryRun) return { ok: true, tripKey: result.trip.key };
      return { ok: true, tripKey: commit(plan, candidate, result.trip) };
    }
  }
  return { ok: false, tried, lastFailure };
}

function commit(plan: AllocPlan, candidate: Candidate, trip: Trip): string {
  if (candidate.kind === 'TRIP') plan.set(candidate.planTrip.key, trip);
  else plan.add(trip);
  return trip.key;
}
