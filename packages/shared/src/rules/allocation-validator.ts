import {
  MAX_TRIPS_PER_VEHICLE_PER_DAY,
  type Brand,
  type ParkingConstraint,
  type TempClass,
  type VehicleTemp,
  type VehicleType,
} from '../domain';
import { budgetWindowFor, DAILY_TIME_BUDGET_MIN } from './trip-time';

/**
 * Constraint validator shared by the planning engine, the dispatcher UI
 * (instant feedback on manual moves) and the Datathon Task 2B check.
 * It reports every broken rule instead of stopping at the first one.
 */

export type RuleId =
  | 'brand_district'
  | 'refrigeration'
  | 'vehicle_access'
  | 'home_depot'
  | 'capacity_weight'
  | 'capacity_volume'
  | 'max_trips'
  | 'time_budget'
  | 'vehicle_unavailable';

export interface Violation {
  rule: RuleId;
  message: string;
  vehicleId: string;
  tripNumber?: number;
  orderRef?: string;
}

export interface ValidatorVehicle {
  id: string;
  type: VehicleType;
  temp: VehicleTemp;
  depot: string;
  weightCapKg: number;
  volumeCapM3: number;
  available: boolean;
}

export interface ValidatorOrder {
  ref: string;
  brand: Brand;
  district: string;
  depot: string;
  tempClass: TempClass;
  parkingConstraint: ParkingConstraint;
  weightKg: number;
  volumeM3: number;
}

export interface ValidatorTrip {
  vehicleId: string;
  tripNumber: number;
  orders: readonly ValidatorOrder[];
  /** Precomputed with tripMinutes(). */
  minutes: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function validateTrip(
  trip: ValidatorTrip,
  vehicle: ValidatorVehicle,
): Violation[] {
  const violations: Violation[] = [];
  const base = { vehicleId: vehicle.id, tripNumber: trip.tripNumber };
  const [first] = trip.orders;

  if (!vehicle.available) {
    violations.push({
      ...base,
      rule: 'vehicle_unavailable',
      message: `${vehicle.id} is not available`,
    });
  }

  for (const order of trip.orders) {
    const o = { ...base, orderRef: order.ref };
    if (first && (order.brand !== first.brand || order.district !== first.district)) {
      violations.push({
        ...o,
        rule: 'brand_district',
        message: `A trip serves one brand and district (${first.brand}/${first.district}); ${order.ref} is ${order.brand}/${order.district}`,
      });
    }
    if (order.tempClass === 'CHILLED' && vehicle.temp !== 'REEFER') {
      violations.push({
        ...o,
        rule: 'refrigeration',
        message: `${order.ref} is chilled but ${vehicle.id} is not refrigerated`,
      });
    }
    if (order.parkingConstraint === 'VAN_ONLY' && vehicle.type !== 'VAN') {
      violations.push({
        ...o,
        rule: 'vehicle_access',
        message: `${order.ref} is van-only but ${vehicle.id} is a ${vehicle.type}`,
      });
    }
    if (order.depot !== vehicle.depot) {
      violations.push({
        ...o,
        rule: 'home_depot',
        message: `${order.ref} belongs to ${order.depot}; ${vehicle.id} is based at ${vehicle.depot}`,
      });
    }
  }

  const weight = trip.orders.reduce((s, o) => s + o.weightKg, 0);
  const volume = trip.orders.reduce((s, o) => s + o.volumeM3, 0);
  if (weight > vehicle.weightCapKg) {
    violations.push({
      ...base,
      rule: 'capacity_weight',
      message: `Load ${round(weight)} kg exceeds ${vehicle.weightCapKg} kg`,
    });
  }
  if (volume > vehicle.volumeCapM3) {
    violations.push({
      ...base,
      rule: 'capacity_volume',
      message: `Load ${round(volume)} m³ exceeds ${vehicle.volumeCapM3} m³`,
    });
  }
  return violations;
}

/** Checks a vehicle's whole day: each trip plus trip count and time budgets. */
export function validateVehicleDay(
  vehicle: ValidatorVehicle,
  trips: readonly ValidatorTrip[],
): Violation[] {
  const violations = trips.flatMap((t) => validateTrip(t, vehicle));

  if (trips.length > MAX_TRIPS_PER_VEHICLE_PER_DAY) {
    violations.push({
      vehicleId: vehicle.id,
      rule: 'max_trips',
      message: `${vehicle.id} has ${trips.length} trips; the limit is ${MAX_TRIPS_PER_VEHICLE_PER_DAY}`,
    });
  }

  const used = { fresh: 0, styleAndTech: 0 };
  for (const trip of trips) {
    const brand = trip.orders[0]?.brand;
    if (brand) used[budgetWindowFor(brand)] += trip.minutes;
  }
  for (const window of ['fresh', 'styleAndTech'] as const) {
    if (used[window] > DAILY_TIME_BUDGET_MIN[window]) {
      violations.push({
        vehicleId: vehicle.id,
        rule: 'time_budget',
        message: `${vehicle.id} uses ${round(used[window])} of ${DAILY_TIME_BUDGET_MIN[window]} ${window === 'fresh' ? 'Fresh' : 'Style + Tech'} minutes`,
      });
    }
  }
  return violations;
}
