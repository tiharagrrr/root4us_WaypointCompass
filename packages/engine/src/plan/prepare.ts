import { resolveParams, type EngineParams } from '../params';
import type { EngineInput, Plan, Trip } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { buildLookups, measureTrip, type Lookups } from './measure';
import { planDow } from './plan-date';

export interface PreparedPlan {
  params: EngineParams;
  /** Day of the week of the plan date, 0 = Monday. */
  dow: number;
  lookups: Lookups;
  /** Every trip in the plan, fixed trips included, measured and sorted by key. */
  trips: Trip[];
}

/**
 * Checks the plan date and measures every trip from its orders. validate() and the manual helpers
 * both start here, so they always agree on what a plan contains.
 */
export function preparePlan(input: EngineInput, plan: Plan): PreparedPlan {
  // Refuse an impossible plan date first, whether or not the plan has trips on it.
  const dow = planDow(input.date);
  const params = resolveParams(input.params);
  const lookups = buildLookups(input);
  const measured = plan.trips.map((draft, i) => measureTrip(input, lookups, draft, `plan.trips[${i}]`));
  const trips = stableSort([...input.fixedTrips, ...measured], (a, b) => compareText(a.key, b.key));
  return { params, dow, lookups, trips };
}
