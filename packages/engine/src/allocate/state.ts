import type { Brand } from '@waypoint/shared/domain';
import { tripKeyOf } from '../plan/measure';
import type { Trip, TripDraft } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { type AllocContext } from './context';
import { vehicleOf } from './fits';

/** A trip in the plan being built, with what the allocator is allowed to do to it. */
export interface PlanTrip {
  readonly key: string;
  readonly vehicleId: string;
  readonly tripNo: number;
  readonly brand: Brand;
  readonly districtId: string;
  /** The allocator may add orders to it. A trip kept from the input is closed. */
  readonly open: boolean;
  readonly locked: boolean;
  readonly reserved: boolean;
  /** Measured, with its stops in visiting order. */
  trip: Trip;
}

const byKey = (a: { key: string }, b: { key: string }) => compareText(a.key, b.key);

/**
 * The plan as the allocator builds it: the trips it owns, plus the fixed trips it must plan around.
 * Fixed trips are kept exactly as they came, never measured again (a released trip's orders need not
 * be in `input.orders`) and never returned as part of the plan, because validate() adds them itself.
 */
export class AllocPlan {
  private readonly own: PlanTrip[] = [];
  private readonly tripKeyOfOrder = new Map<string, string>();

  constructor(
    private readonly ctx: AllocContext,
    private readonly fixed: readonly Trip[],
  ) {}

  /** Every trip the rules must see, fixed trips included, in trip order. */
  allTrips(): Trip[] {
    return stableSort([...this.fixed, ...this.own.map((t) => t.trip)], byKey);
  }

  /** The plan's own trips, in trip order. */
  planTrips(): PlanTrip[] {
    return stableSort(this.own, byKey);
  }

  openTrips(): PlanTrip[] {
    return this.planTrips().filter((t) => t.open);
  }

  tripKeyOf(orderId: string): string | undefined {
    return this.tripKeyOfOrder.get(orderId);
  }

  private tripsOf(vehicleId: string): number {
    return (
      this.fixed.filter((t) => t.vehicleId === vehicleId).length +
      this.own.filter((t) => t.vehicleId === vehicleId).length
    );
  }

  /** How many more trips the vehicle could run today. */
  freeSlotCount(vehicleId: string): number {
    return Math.max(0, this.ctx.params.maxTripsPerVehicle - this.tripsOf(vehicleId));
  }

  /** The lowest trip number the vehicle has free, or null when it is at the trip limit. */
  freeSlot(vehicleId: string): number | null {
    if (this.tripsOf(vehicleId) >= this.ctx.params.maxTripsPerVehicle) return null;
    const used = new Map<number, true>();
    for (const t of this.fixed) if (t.vehicleId === vehicleId) used.set(t.tripNo, true);
    for (const t of this.own) if (t.vehicleId === vehicleId) used.set(t.tripNo, true);
    for (let no = 1; no <= this.ctx.params.maxTripsPerVehicle; no += 1) if (!used.has(no)) return no;
    return null;
  }

  /** A trip with no orders yet, for the packer to try: it is not in the plan until something fits. */
  draftTrip(vehicleId: string, tripNo: number, brand: Brand, districtId: string): TripDraft {
    return {
      key: tripKeyOf(vehicleOf(this.ctx, vehicleId).code, tripNo),
      vehicleId,
      tripNo,
      brand,
      districtId,
      orderIds: [],
    };
  }

  add(trip: Trip, flags: { locked?: boolean; reserved?: boolean } = {}): PlanTrip {
    const planTrip: PlanTrip = {
      key: trip.key,
      vehicleId: trip.vehicleId,
      tripNo: trip.tripNo,
      brand: trip.brand,
      districtId: trip.districtId,
      open: !(flags.locked ?? false),
      locked: flags.locked ?? false,
      reserved: flags.reserved ?? false,
      trip,
    };
    this.own.push(planTrip);
    for (const id of trip.orderIds) this.tripKeyOfOrder.set(id, trip.key);
    return planTrip;
  }

  /** Replaces a trip's stops with a measured, sequenced version of it. */
  set(key: string, trip: Trip): void {
    const planTrip = this.own.find((t) => t.key === key);
    if (!planTrip) return;
    for (const id of planTrip.trip.orderIds) this.tripKeyOfOrder.delete(id);
    planTrip.trip = trip;
    for (const id of trip.orderIds) this.tripKeyOfOrder.set(id, trip.key);
  }

  /** Drops a trip the allocator opened and could not fill. A reservation is kept: it holds a slot. */
  dropEmptyUnreserved(): void {
    for (let i = this.own.length - 1; i >= 0; i -= 1) {
      const planTrip = this.own[i];
      if (planTrip && planTrip.trip.orderIds.length === 0 && !planTrip.reserved && !planTrip.locked) {
        this.own.splice(i, 1);
      }
    }
  }
}
