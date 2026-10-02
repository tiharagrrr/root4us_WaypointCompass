import { buildInput } from '../../rules/__tests__/fixture';
import type { EngineInput, Plan, TripDraft } from '../../types';

/** Freezes a value and everything inside it, so a function that mutates its input throws. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

const GAMPAHA = 'fx-gampaha';

export const trip = (vehicleId: string, tripNo: number, orderIds: string[], extra: Partial<TripDraft> = {}): TripDraft => ({
  vehicleId,
  tripNo,
  brand: 'FRESH',
  districtId: GAMPAHA,
  orderIds,
  ...extra,
});

export interface Scenario {
  input: EngineInput;
  plan: Plan;
}

/**
 * AC-PLN-02's world. REF-07 (12 m³) holds o1 and o2 (11.5 m³); REF-03 holds o3 (0.92 m³), so moving
 * o3 onto REF-07#1 makes 12.42 m³ against 12.0. REF-11 is a spare reefer; o4 and o5 are unassigned.
 */
export function capacityScenario(): Scenario {
  const reefer = (n: number, code: string) => ({ id: `fx-veh-${n}`, code, temp: 'REEFER', volumeCapM3: 12 });
  const chilled = (n: number, volumeM3: number, extra: Record<string, unknown> = {}) => ({
    id: `fx-ord-${n}`,
    outletId: 'fx-out-1',
    tempClass: 'CHILLED',
    volumeM3,
    ...extra,
  });
  const input = buildInput({
    vehicles: [reefer(1, 'REF-07'), reefer(2, 'REF-03'), reefer(3, 'REF-11')],
    outlets: { 'fx-out-1': {} },
    orders: [chilled(1, 6), chilled(2, 5.5), chilled(3, 0.92), chilled(4, 0.5), chilled(5, 0.3)],
  });
  const plan: Plan = {
    trips: [trip('fx-veh-1', 1, ['fx-ord-1', 'fx-ord-2']), trip('fx-veh-2', 1, ['fx-ord-3'])],
    unplanned: [],
  };
  return { input, plan };
}

/**
 * AC-PLN-15's world. REF-07 already has two trips, REF-11 is in the workshop, DRY-12 has broken
 * down, and DRY-31 is free.
 */
export function fleetScenario(): Scenario {
  const input = buildInput({
    vehicles: [
      { id: 'fx-veh-1', code: 'REF-07', temp: 'REEFER' },
      { id: 'fx-veh-2', code: 'REF-11', temp: 'REEFER', available: false, unavailableReason: 'WORKSHOP' },
      { id: 'fx-veh-3', code: 'DRY-31' },
      { id: 'fx-veh-4', code: 'DRY-12', available: false, unavailableReason: 'BREAKDOWN' },
    ],
    outlets: { 'fx-out-1': {} },
    orders: [
      { id: 'fx-ord-1', outletId: 'fx-out-1', tempClass: 'CHILLED' },
      { id: 'fx-ord-2', outletId: 'fx-out-1', tempClass: 'CHILLED' },
      { id: 'fx-ord-3', outletId: 'fx-out-1' },
      { id: 'fx-ord-4', outletId: 'fx-out-1', tempClass: 'CHILLED' },
      { id: 'fx-ord-5', outletId: 'fx-out-1', brand: 'STYLE' },
    ],
    fuelUsedThisWeek: { 'fx-veh-1': 100 },
  });
  const plan: Plan = {
    trips: [trip('fx-veh-1', 1, ['fx-ord-1']), trip('fx-veh-1', 2, ['fx-ord-2'])],
    unplanned: [],
  };
  return { input, plan };
}

/** A copy of the input with one order's fields changed. */
export function withOrder(input: EngineInput, id: string, change: Record<string, unknown>): EngineInput {
  return { ...input, orders: input.orders.map((o) => (o.id === id ? { ...o, ...change } : o)) };
}

export const CODES: Record<string, string> = { 'fx-veh-1': 'REF-07', 'fx-veh-2': 'REF-03', 'fx-veh-3': 'REF-11' };

/** trip key -> order ids, for readable assertions. */
export function ordersByTrip(plan: Plan, codes: Record<string, string> = CODES): Record<string, readonly string[]> {
  return Object.fromEntries(plan.trips.map((t) => [`${codes[t.vehicleId] ?? t.vehicleId}#${t.tripNo}`, t.orderIds]));
}
