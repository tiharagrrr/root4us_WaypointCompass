import type { EngineParams } from '../../params';
import { buildInput } from '../../rules/__tests__/fixture';
import type {
  EngineDistrict,
  EngineInput,
  EngineOrder,
  EngineOutlet,
  EngineVehicle,
  Trip,
  TripDraft,
} from '../../types';

/**
 * Hand-built allocator cases. Every number here is invented, small enough to work out on paper, and
 * never taken from the datasets (specs/data/datasets.md is the only source for shapes).
 *
 * The defaults come from the rule fixtures: a 1000 kg, 10 m³ ambient truck at fx-depot-1, outlets open
 * all day in fx-gampaha (37 minutes out, 9 between stops) and 15-minute service allowances, so a case
 * only says what it is about.
 */
export interface ScenarioSpec {
  date?: string;
  isOperatingDay?: boolean;
  vehicles: readonly (Partial<EngineVehicle> & { id: string })[];
  orders: readonly (Partial<EngineOrder> & { id: string })[];
  outlets?: Readonly<Record<string, Partial<EngineOutlet>>>;
  districts?: Readonly<Record<string, Partial<EngineDistrict>>>;
  history?: EngineInput['history'];
  fuelUsedThisWeek?: Readonly<Record<string, number>>;
  fixedTrips?: readonly Trip[];
  lockedTrips?: readonly TripDraft[];
  reservedTrips?: readonly TripDraft[];
  params?: Partial<EngineParams>;
}

/** Vehicle fx-veh-1 is FV1, order fx-ord-1 is FO-1, so trip keys read FV1#1. */
export function scenario(spec: ScenarioSpec): EngineInput {
  const orders = spec.orders.map((order) => ({ outletId: 'fx-out-1', ...order }));
  const outlets: Record<string, Partial<EngineOutlet>> = {};
  for (const order of orders) outlets[order.outletId] = spec.outlets?.[order.outletId] ?? {};
  for (const [id, outlet] of Object.entries(spec.outlets ?? {})) outlets[id] = outlet;
  return buildInput(
    {
      date: spec.date,
      isOperatingDay: spec.isOperatingDay,
      vehicles: spec.vehicles,
      orders,
      outlets,
      districts: spec.districts,
      history: spec.history,
      fuelUsedThisWeek: spec.fuelUsedThisWeek,
      fixedTrips: spec.fixedTrips,
      lockedTrips: spec.lockedTrips,
      reservedTrips: spec.reservedTrips,
    },
    spec.params ?? {},
  );
}

/** Reverses every list and every table's key order, which is all an allocator may not depend on. */
export function shuffled(input: EngineInput): EngineInput {
  const reverseKeys = <T>(table: Readonly<Record<string, T>>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const key of Object.keys(table).reverse()) {
      const value = table[key];
      if (value !== undefined) out[key] = value;
    }
    return out;
  };
  return {
    ...input,
    vehicles: [...input.vehicles].reverse(),
    orders: [...input.orders].reverse(),
    outlets: reverseKeys(input.outlets),
    districts: reverseKeys(input.districts),
    history: reverseKeys(input.history),
    fuelUsedThisWeek: reverseKeys(input.fuelUsedThisWeek),
    fixedTrips: [...input.fixedTrips].reverse(),
    lockedTrips: [...(input.lockedTrips ?? [])].reverse(),
    reservedTrips: [...(input.reservedTrips ?? [])].reverse(),
  };
}

/** The orders on each trip, keyed by trip, for a readable assertion. */
export function stopsByTrip(trips: readonly Trip[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const trip of trips) out[trip.key] = [...trip.orderIds];
  return out;
}

export function tripKeysOf(trips: readonly Trip[]): string[] {
  return trips.map((trip) => trip.key);
}
