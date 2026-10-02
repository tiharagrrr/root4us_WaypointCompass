import { preparePlan } from './plan/prepare';
import { RULES } from './rules/index';
import type { EngineInput, Plan, RuleContext, Trip, Violation } from './types';
import { compareText, stableSort } from './util/stable-sort';

/**
 * Runs every enabled rule over a plan or a proposed edit. Trips are measured from their orders, so a
 * stale total cannot hide a violation. Fixed trips (released or in progress) count with the plan's.
 * The result is sorted by rule, then trip, vehicle and order, so the same plan always reads the same.
 */
export function validate(input: EngineInput, plan: Plan): Violation[] {
  const { params, dow, lookups, trips } = preparePlan(input, plan);
  const unplanned = stableSort(plan.unplanned, (a, b) => compareText(a.orderId, b.orderId));
  const base: RuleContext = { input, params, trips, unplanned, orderById: lookups.orderById, planDow: dow };

  const tripsByVehicle = new Map<string, Trip[]>();
  for (const trip of trips) tripsByVehicle.set(trip.vehicleId, [...(tripsByVehicle.get(trip.vehicleId) ?? []), trip]);
  const vehicleIds = stableSort([...tripsByVehicle.keys()], compareText);

  const found: Violation[] = [];
  for (const rule of RULES) {
    if (rule.enabled && !rule.enabled(params)) continue;
    switch (rule.scope) {
      case 'trip':
        for (const trip of trips) {
          const vehicle = lookups.vehicleById.get(trip.vehicleId);
          if (vehicle) found.push(...rule.check({ ...base, trip, vehicle }));
        }
        break;
      case 'vehicle':
        for (const id of vehicleIds) {
          const vehicle = lookups.vehicleById.get(id);
          const vehicleTrips = tripsByVehicle.get(id);
          if (vehicle && vehicleTrips) found.push(...rule.check({ ...base, vehicle, vehicleTrips }));
        }
        break;
      case 'order':
        for (const unplannedOrder of unplanned) found.push(...rule.check({ ...base, unplannedOrder }));
        break;
      case 'plan':
        found.push(...rule.check(base));
        break;
    }
  }

  const order = new Map(RULES.map((r, i) => [r.code, i]));
  const key = (v: Violation) =>
    [String(order.get(v.rule)).padStart(2, '0'), v.tripKey ?? '', v.vehicleId ?? '', v.orderId ?? '', v.message].join('\u0000');
  return stableSort(found, (a, b) => compareText(key(a), key(b)));
}
