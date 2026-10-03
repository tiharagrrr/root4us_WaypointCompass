import type { Brand, TempClass } from '@waypoint/shared/domain';
import type { EngineVehicle } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { outletOf, type AllocContext } from './context';
import type { RankedOrder } from './priority';

/** A trip carries one temperature class, so the two never share a vehicle unless a rule allows it. */
export type TripClass = 'CHILLED' | 'AMBIENT';

export function tripClassOf(tempClass: TempClass): TripClass {
  return tempClass === 'CHILLED' ? 'CHILLED' : 'AMBIENT';
}

export function groupKeyOf(brand: Brand, districtId: string, tripClass: TripClass): string {
  return `${brand}|${districtId}|${tripClass}`;
}

/** Orders that can share a trip: one brand, one district, one temperature class. */
export interface OrderGroup {
  key: string;
  brand: Brand;
  districtId: string;
  tripClass: TripClass;
  /** Every order in the group is at a van-only outlet, so any trip serving it needs a van. */
  needsVan: boolean;
  /** At least one order is at a van-only outlet. */
  hasVanOnly: boolean;
  /** In packing order: priority descending, then the largest share of a vehicle first. */
  orders: readonly RankedOrder[];
  demandWeightKg: number;
  demandVolumeM3: number;
  /** Vehicles the group prefers: reefers for chilled, ambient vehicles for ambient; vans when it needs one. */
  preferredVehicleIds: readonly string[];
  /** Demand over the capacity of those vehicles. Above 1 the group cannot all be served. */
  scarcity: number;
}

/** Capacity with none of it left is the scarcest there is, without reaching for Infinity. */
const NO_CAPACITY_SCARCITY = 1e9;

function prefersVehicle(group: { tripClass: TripClass; needsVan: boolean }, vehicle: EngineVehicle): boolean {
  if (group.needsVan && vehicle.type !== 'VAN') return false;
  return group.tripClass === 'CHILLED' ? vehicle.temp === 'REEFER' : vehicle.temp === 'AMBIENT';
}

/**
 * The orders keyed by brand, district and temperature class, scarcest group first, so reefer and van
 * groups claim the vehicles only they can use before ambient trucks are spread thin. `freeSlots` says
 * how many trips a vehicle has left, so trips already in the plan do not count as capacity.
 */
export function groupOrders(
  ctx: AllocContext,
  ranked: readonly RankedOrder[],
  freeSlots: (vehicleId: string) => number,
): OrderGroup[] {
  const byKey = new Map<string, RankedOrder[]>();
  for (const entry of ranked) {
    const key = groupKeyOf(entry.order.brand, entry.order.districtId, tripClassOf(entry.order.tempClass));
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }

  const groups = [...byKey.keys()].map((key) => {
    const members = byKey.get(key) ?? [];
    const first = members[0];
    if (!first) throw new Error(`group ${key} has no orders`);
    const vanOnly = members.map((m) => outletOf(ctx, m.order).parkingConstraint === 'VAN_ONLY');
    const shape = {
      key,
      brand: first.order.brand,
      districtId: first.order.districtId,
      tripClass: tripClassOf(first.order.tempClass),
      needsVan: vanOnly.every((v) => v),
      hasVanOnly: vanOnly.some((v) => v),
    };
    const preferred = ctx.input.vehicles.filter((v) => v.available && prefersVehicle(shape, v));
    let weightCap = 0;
    let volumeCap = 0;
    let largestWeightCap = 0;
    let largestVolumeCap = 0;
    for (const vehicle of preferred) {
      const slots = freeSlots(vehicle.id);
      weightCap += vehicle.weightCapKg * slots;
      volumeCap += vehicle.volumeCapM3 * slots;
      largestWeightCap = Math.max(largestWeightCap, vehicle.weightCapKg);
      largestVolumeCap = Math.max(largestVolumeCap, vehicle.volumeCapM3);
    }
    let demandWeightKg = 0;
    let demandVolumeM3 = 0;
    for (const member of members) {
      demandWeightKg += member.order.weightKg;
      demandVolumeM3 += member.order.volumeM3;
    }
    const share = (entry: RankedOrder) =>
      Math.max(
        largestWeightCap > 0 ? entry.order.weightKg / largestWeightCap : 0,
        largestVolumeCap > 0 ? entry.order.volumeM3 / largestVolumeCap : 0,
      );
    // Priority bands first; inside a band the order that fills the most of a vehicle goes first,
    // because the room it needs is hardest to find later.
    const orders = stableSort(
      members,
      (a, b) =>
        b.priority - a.priority ||
        share(b) - share(a) ||
        a.closeMin - b.closeMin ||
        compareText(a.order.ref, b.order.ref),
    );
    const ratio = (demand: number, cap: number) =>
      cap > 0 ? demand / cap : demand > 0 ? NO_CAPACITY_SCARCITY : 0;
    return {
      ...shape,
      orders,
      demandWeightKg,
      demandVolumeM3,
      preferredVehicleIds: stableSort(preferred, (a, b) => compareText(a.id, b.id)).map((v) => v.id),
      scarcity: Math.max(ratio(demandWeightKg, weightCap), ratio(demandVolumeM3, volumeCap)),
    };
  });

  return stableSort(groups, (a, b) => b.scarcity - a.scarcity || compareText(a.key, b.key));
}
