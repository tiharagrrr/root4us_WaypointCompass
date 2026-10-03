import { BRANDS, TEMP_CLASSES, type Brand, type TempClass } from '@waypoint/shared/domain';
import { SCARCE_RESOURCES, type ScarceResource } from '../rules/codes';
import type {
  DeferralCost,
  EngineOrder,
  EngineVehicle,
  Excluded,
  PlanStats,
  ResourceUse,
  ServedCount,
  Trip,
  Unplanned,
} from '../types';
import { lte, round } from '../util/lte';
import { stableSort } from '../util/stable-sort';
import { orderOf, historyOf, type AllocContext } from './context';
import { fits, vehicleOf } from './fits';
import { vehicleKindFor } from './reasons';
import { isRepeatSkip } from '../plan/repeat-skip';

/** How each resource is named and counted in the sentences explain() writes. */
export interface ResourceLabel {
  /** The subject of the plan sentence: "Reefer capacity was the limit". */
  label: string;
  /** The kind of trip counted: "11 of 12 reefer trips are full". */
  tripWord: string;
  /** What the percentage is of: "(97% of volume)". */
  measure: string;
  unit: string;
}

export const RESOURCE_LABELS: Readonly<Record<ScarceResource, ResourceLabel>> = {
  REEFER_VOLUME: { label: 'Reefer capacity', tripWord: 'reefer', measure: 'volume', unit: 'm³' },
  VAN_TRIPS: { label: 'Van capacity', tripWord: 'van', measure: 'trips', unit: 'trips' },
  FRESH_MINUTES: { label: 'Fresh minutes', tripWord: 'Fresh', measure: 'minutes', unit: 'min' },
  STYLE_TECH_MINUTES: {
    label: 'Style and Tech minutes',
    tripWord: 'Style and Tech',
    measure: 'minutes',
    unit: 'min',
  },
  // Fuel is not a trip count: a trip spends it, but the quota is the vehicle's for the whole week.
  FUEL: { label: 'The weekly fuel quota', tripWord: 'fuelled', measure: 'litres', unit: 'L' },
};

const isReefer = (v: EngineVehicle) => v.temp === 'REEFER';
const isVan = (v: EngineVehicle) => v.type === 'VAN';

/** The resource a deferral points at, so a resource is only called limiting when it cost something. */
function resourceBlaming(ctx: AllocContext, unplanned: Unplanned): ScarceResource | null {
  switch (unplanned.bindingRule) {
    case 'TEMP_REEFER':
      return 'REEFER_VOLUME';
    case 'ACCESS_VAN_ONLY':
      return 'VAN_TRIPS';
    case 'BUDGET_FRESH':
      return 'FRESH_MINUTES';
    case 'BUDGET_STYLE_TECH':
      return 'STYLE_TECH_MINUTES';
    case 'FUEL_WEEKLY':
      return 'FUEL';
    case 'CAP_WEIGHT':
    case 'CAP_VOLUME':
    case 'TRIP_LIMIT': {
      // A full vehicle only names a resource when the order needed a particular kind of vehicle.
      const kind = vehicleKindFor(ctx, orderOf(ctx, unplanned.orderId));
      if (kind === 'reefer') return 'REEFER_VOLUME';
      return kind === 'van' ? 'VAN_TRIPS' : null;
    }
    default:
      return null;
  }
}

/** Whether any order still waiting could join this trip. A trip nothing fits on is full. */
function canTakeMore(
  ctx: AllocContext,
  current: readonly Trip[],
  trip: Trip,
  waiting: readonly EngineOrder[],
): boolean {
  for (const order of waiting) {
    if (fits(ctx, current, trip, [...trip.orderIds, order.id]).ok) return true;
  }
  return false;
}

interface ResourceSpec {
  resource: ScarceResource;
  /** The trips this resource is spent on. */
  countsTrip: (trip: Trip, vehicle: EngineVehicle) => boolean;
  used: number;
  total: number;
}

function specsFor(ctx: AllocContext, trips: readonly Trip[]): ResourceSpec[] {
  const fleet = ctx.input.vehicles.filter((v) => v.available);
  const slots = ctx.params.maxTripsPerVehicle;
  const vehicleOfTrip = (trip: Trip) => vehicleOf(ctx, trip.vehicleId);
  const sum = (pick: (trip: Trip, vehicle: EngineVehicle) => number) =>
    trips.reduce((total, trip) => total + pick(trip, vehicleOfTrip(trip)), 0);

  const minutes = (brand: (b: Brand) => boolean, budget: number) => ({
    used: sum((trip) => (brand(trip.brand) ? trip.minutes : 0)),
    total: fleet.length * budget,
  });
  const fresh = minutes((b) => b === 'FRESH', ctx.params.freshBudgetMin);
  const styleTech = minutes((b) => b !== 'FRESH', ctx.params.styleTechBudgetMin);

  let fuelUsed = 0;
  let fuelTotal = 0;
  for (const vehicle of fleet) {
    fuelUsed += ctx.input.fuelUsedThisWeek[vehicle.id] ?? 0;
    fuelTotal += vehicle.weeklyFuelQuotaL;
  }
  fuelUsed += sum((trip) => trip.litres);

  return [
    {
      resource: 'REEFER_VOLUME',
      countsTrip: (_trip, vehicle) => isReefer(vehicle),
      used: sum((trip, vehicle) => (isReefer(vehicle) ? trip.volumeM3 : 0)),
      total: fleet.filter(isReefer).reduce((total, v) => total + v.volumeCapM3 * slots, 0),
    },
    {
      resource: 'VAN_TRIPS',
      countsTrip: (_trip, vehicle) => isVan(vehicle),
      used: trips.filter((trip) => isVan(vehicleOfTrip(trip))).length,
      total: fleet.filter(isVan).length * slots,
    },
    {
      resource: 'FRESH_MINUTES',
      countsTrip: (trip) => trip.brand === 'FRESH',
      used: fresh.used,
      total: fresh.total,
    },
    {
      resource: 'STYLE_TECH_MINUTES',
      countsTrip: (trip) => trip.brand !== 'FRESH',
      used: styleTech.used,
      total: styleTech.total,
    },
    { resource: 'FUEL', countsTrip: () => false, used: fuelUsed, total: fuelTotal },
  ];
}

/**
 * How much of each scarce resource the plan used. The percentage is of everything the fleet has, so a
 * resource with slots to spare is never called the limit; the trip counts are of the trips the plan
 * actually runs, which is what the sentence reads out.
 */
export function resourceUse(
  ctx: AllocContext,
  all: readonly Trip[],
  trips: readonly Trip[],
  unplanned: readonly Unplanned[],
): ResourceUse[] {
  const waiting = unplanned.map((u) => orderOf(ctx, u.orderId));
  const blamed = new Map<ScarceResource, true>();
  for (const u of unplanned) {
    const resource = resourceBlaming(ctx, u);
    if (resource) blamed.set(resource, true);
  }
  const specs = specsFor(ctx, trips);
  const byResource = new Map(specs.map((s) => [s.resource, s]));

  return SCARCE_RESOURCES.map((resource) => {
    const spec = byResource.get(resource);
    if (!spec) throw new Error(`no spec for resource ${resource}`);
    const own = trips.filter((trip) => spec.countsTrip(trip, vehicleOf(ctx, trip.vehicleId)));
    const full = own.filter((trip) => !canTakeMore(ctx, all, trip, waiting));
    const pct = spec.total > 0 ? round((spec.used / spec.total) * 100, 0) : 0;
    const causedDeferrals = blamed.has(resource);
    return {
      resource,
      used: round(spec.used),
      total: round(spec.total),
      pct,
      measure: RESOURCE_LABELS[resource].measure,
      unit: RESOURCE_LABELS[resource].unit,
      fullTrips: full.length,
      trips: own.length,
      causedDeferrals,
      limiting: causedDeferrals && lte(ctx.params.limitingUtilisationPct, pct),
    };
  });
}

function emptyCost(): DeferralCost {
  return { orders: 0, units: 0, volumeM3: 0, weightKg: 0, outlets: 0 };
}

function costOf(orders: readonly EngineOrder[]): DeferralCost {
  const outlets = new Map<string, true>();
  const cost = emptyCost();
  for (const order of orders) {
    cost.orders += 1;
    cost.units += order.units;
    cost.volumeM3 += order.volumeM3;
    cost.weightKg += order.weightKg;
    outlets.set(order.outletId, true);
  }
  return {
    ...cost,
    volumeM3: round(cost.volumeM3),
    weightKg: round(cost.weightKg),
    outlets: outlets.size,
  };
}

function counted<K extends string>(keys: readonly K[]): Record<K, ServedCount> {
  const counts = {} as Record<K, ServedCount>;
  for (const key of keys) counts[key] = { served: 0, deferred: 0 };
  return counts;
}

/**
 * The plan in numbers: who was served, what waits, how much of each scarce resource went, and what
 * the deferrals cost. explain() turns these into sentences; it never works anything out itself.
 */
export function statsOf(
  ctx: AllocContext,
  all: readonly Trip[],
  trips: readonly Trip[],
  unplanned: readonly Unplanned[],
  excluded: readonly Excluded[],
): PlanStats {
  const byBrand = counted<Brand>(BRANDS);
  const byTempClass = counted<TempClass>(TEMP_CLASSES);
  let served = 0;
  let repeatSkipsAvoided = 0;
  for (const trip of trips) {
    for (const id of trip.orderIds) {
      const order = orderOf(ctx, id);
      served += 1;
      byBrand[order.brand].served += 1;
      byTempClass[order.tempClass].served += 1;
      if (isRepeatSkip(historyOf(ctx, order), ctx.params)) repeatSkipsAvoided += 1;
    }
  }
  const deferredOrders = unplanned.map((u) => orderOf(ctx, u.orderId));
  for (const order of deferredOrders) {
    byBrand[order.brand].deferred += 1;
    byTempClass[order.tempClass].deferred += 1;
  }
  const resources = resourceUse(ctx, all, trips, unplanned);
  const choiceOf = (choice: string) =>
    costOf(unplanned.filter((u) => u.choice === choice).map((u) => orderOf(ctx, u.orderId)));

  return {
    orders: ctx.input.orders.length,
    served,
    deferred: unplanned.length,
    excluded: excluded.length,
    trips: trips.length,
    byBrand,
    byTempClass,
    resources,
    limiting: stableSort(
      resources.filter((r) => r.limiting),
      (a, b) => b.pct - a.pct,
    ),
    repeatSkipsAvoided,
    repeatSkipsIncurred: unplanned.filter((u) => u.repeatSkip).length,
    unavoidable: choiceOf('UNAVOIDABLE'),
    chosen: choiceOf('PRIORITY_CHOICE'),
  };
}
