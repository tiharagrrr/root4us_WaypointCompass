import { preparePlan } from '../plan/prepare';
import type { EngineInput, Plan, Violation } from '../types';
import { round } from '../util/lte';
import { validate } from '../validate';
import { applyOps } from './apply-edits';
import type { EditOp } from './edit-ops';
import { violationKey } from './violation-key';

export { violationKey };

/** What a trip carries and costs. */
export interface TripTotals {
  weightKg: number;
  volumeM3: number;
  minutes: number;
  litres: number;
}

export interface FitsResult {
  /** No hard violation was caused by adding the order. */
  fits: boolean;
  /** The hard violations the order would cause: the reason it is dimmed. */
  blocking: Violation[];
  /** The soft violations it would cause: it fits, with a warning. */
  warnings: Violation[];
  /** The trip with the order on it. */
  result: TripTotals;
}

/**
 * Tries the edits on a copy of `base` and reports what they cause, compared with `before` (the
 * violations `base` already had), plus the totals of the trip `tripKey` afterwards. Used by fits()
 * and by the option lists, so every dimmed reason is exactly what validate() says.
 */
export function evaluateEdits(
  input: EngineInput,
  base: Plan,
  before: readonly Violation[],
  edits: readonly EditOp[],
  tripKey: string,
): FitsResult {
  const next = applyOps(input, base, edits);
  const seen = new Set(before.map(violationKey));
  const introduced = validate(input, next).filter((v) => !seen.has(violationKey(v)));
  const trip = preparePlan(input, next).trips.find((t) => t.key === tripKey);
  const blocking = introduced.filter((v) => v.severity === 'HARD');
  return {
    fits: blocking.length === 0,
    blocking,
    warnings: introduced.filter((v) => v.severity === 'SOFT'),
    result: {
      weightKg: round(trip?.weightKg ?? 0),
      volumeM3: round(trip?.volumeM3 ?? 0),
      minutes: round(trip?.minutes ?? 0),
      litres: round(trip?.litres ?? 0),
    },
  };
}

/**
 * Whether one more order can join a trip. It runs the real rules over the trip with the order on it,
 * so the answer and the reason are the ones validate() would give. The order must be on no trip and
 * the trip must be in the plan.
 */
export function fits(input: EngineInput, plan: Plan, orderId: string, tripKey: string): FitsResult {
  return evaluateEdits(input, plan, validate(input, plan), [{ op: 'ASSIGN_ORDER', orderId, tripKey }], tripKey);
}
