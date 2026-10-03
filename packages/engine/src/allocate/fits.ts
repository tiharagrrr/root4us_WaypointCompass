import { EngineInputError } from '../errors';
import { measureTrip } from '../plan/measure';
import { BINDING_RULES, type BindingRule, type RuleCode } from '../rules/codes';
import { RULE_BY_CODE } from '../rules/index';
import type { EngineVehicle, Trip, TripDraft, Violation } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { ruleContextOf, type AllocContext } from './context';
import { sequenceTrip } from './sequence';

/**
 * The HARD rules that can stop an order joining a trip, in the order they are asked. Eligibility
 * first (a vehicle that can never serve the order), then fullness, then timing, so the first
 * violation is the most telling reason and becomes the deferral's binding rule.
 *
 * WHOLE_ORDER and OPERATING_DAY are the two plan-scope rules and are not here: the allocator places
 * an order once and the pre-screen leaves out an order that is not due today.
 */
export const FIT_RULES: readonly RuleCode[] = [
  'DEPOT_HOME',
  'VEHICLE_AVAILABLE',
  'TEMP_REEFER',
  'ACCESS_VAN_ONLY',
  'TRIP_BRAND_DISTRICT',
  'CAP_WEIGHT',
  'CAP_VOLUME',
  'TRIP_LIMIT',
  'BUDGET_FRESH',
  'BUDGET_STYLE_TECH',
  'FUEL_WEEKLY',
  'WINDOW_OUTLET',
  'WINDOW_MALL',
];

export interface FitFailure {
  ok: false;
  rule: RuleCode;
  /** The same rule when it can be a deferral's reason; DEPOT_HOME and the structural rules cannot. */
  bindingRule: BindingRule | null;
  violation: Violation;
}

export type FitResult = { ok: true; trip: Trip } | FitFailure;

export function bindingRuleOf(rule: RuleCode): BindingRule | null {
  return BINDING_RULES.includes(rule as BindingRule) ? (rule as BindingRule) : null;
}

function fail(rule: RuleCode, violation: Violation): FitFailure {
  return { ok: false, rule, bindingRule: bindingRuleOf(rule), violation };
}

function firstHard(found: readonly Violation[]): Violation | undefined {
  return found.find((v) => v.severity === 'HARD');
}

export function vehicleOf(ctx: AllocContext, vehicleId: string): EngineVehicle {
  const vehicle = ctx.lookups.vehicleById.get(vehicleId);
  if (!vehicle) {
    throw new EngineInputError({
      code: 'UNKNOWN_VEHICLE',
      field: 'allocate.vehicleId',
      value: vehicleId,
      reason: 'is not in input.vehicles',
    });
  }
  return vehicle;
}

const byKey = (a: Trip, b: Trip) => compareText(a.key, b.key);

/** Where a violation sits, so the same one before and after a change is recognised. */
function violationKey(v: Violation): string {
  return [v.rule, v.tripKey ?? '', v.vehicleId ?? '', v.orderId ?? ''].join('\u0000');
}

function hardViolationsOn(
  ctx: AllocContext,
  trips: readonly Trip[],
  trip: Trip,
  vehicle: EngineVehicle,
): Violation[] {
  const rctx = ruleContextOf(ctx, trips);
  const found: Violation[] = [];
  for (const code of FIT_RULES) {
    const rule = RULE_BY_CODE[code];
    if (rule.scope !== 'trip') continue;
    if (rule.enabled && !rule.enabled(ctx.params)) continue;
    for (const v of rule.check({ ...rctx, trip, vehicle })) if (v.severity === 'HARD') found.push(v);
  }
  return found;
}

/**
 * A problem a change gives one of the vehicle's *other* trips. A Fresh trip 2 leaves after trip 1
 * returns, so growing trip 1 can push trip 2 past a window. A problem the trip already had is left
 * alone: it belongs to the plan (a hand-built trip, a vehicle that broke down), not to this
 * placement, and blocking on it would make the vehicle unusable.
 */
function knockOnFailure(
  ctx: AllocContext,
  current: readonly Trip[],
  after: readonly Trip[],
  candidate: Trip,
): FitFailure | null {
  const vehicleTrips = after.filter((t) => t.vehicleId === candidate.vehicleId && t.key !== candidate.key);
  if (vehicleTrips.length === 0) return null;
  const vehicle = vehicleOf(ctx, candidate.vehicleId);
  const before = new Map<string, true>();
  for (const trip of vehicleTrips) {
    for (const v of hardViolationsOn(ctx, current, trip, vehicle)) before.set(violationKey(v), true);
  }
  for (const trip of vehicleTrips) {
    for (const v of hardViolationsOn(ctx, after, trip, vehicle)) {
      if (!before.has(violationKey(v))) return fail(v.rule, v);
    }
  }
  return null;
}

/**
 * Whether this trip is legal, asked of the rules themselves. `current` is every trip in the plan as
 * it stands, fixed trips included; the candidate replaces the trip with its key.
 *
 * The same answer the plan editor shows for a dimmed order, because both call this.
 */
export function checkTrip(ctx: AllocContext, current: readonly Trip[], candidate: Trip): FitResult {
  const vehicle = vehicleOf(ctx, candidate.vehicleId);
  const others = current.filter((t) => t.key !== candidate.key);
  const after = stableSort([...others, candidate], byKey);
  const vehicleTrips = after.filter((t) => t.vehicleId === candidate.vehicleId);
  const rctx = ruleContextOf(ctx, after);

  for (const code of FIT_RULES) {
    const rule = RULE_BY_CODE[code];
    if (rule.enabled && !rule.enabled(ctx.params)) continue;
    const found =
      rule.scope === 'vehicle'
        ? rule.check({ ...rctx, vehicle, vehicleTrips })
        : rule.check({ ...rctx, trip: candidate, vehicle });
    const hard = firstHard(found);
    if (hard) return fail(code, hard);
  }
  return knockOnFailure(ctx, current, after, candidate) ?? { ok: true, trip: candidate };
}

/**
 * Whether the trip can carry these orders, with the stops sequenced as the allocator would run them.
 * The measured, sequenced trip comes back on success, ready to go into the plan.
 */
export function fits(
  ctx: AllocContext,
  current: readonly Trip[],
  draft: TripDraft,
  orderIds: readonly string[],
): FitResult {
  const measured = measureTrip(ctx.input, ctx.lookups, { ...draft, orderIds });
  const others = current.filter((t) => t.key !== measured.key);
  return checkTrip(ctx, current, sequenceTrip(ctx, others, measured));
}
