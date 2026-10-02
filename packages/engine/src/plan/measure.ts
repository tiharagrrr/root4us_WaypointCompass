import { EngineInputError } from '../errors';
import { tripKm, tripLitres } from '../time/fuel';
import { tripMinutes } from '../time/trip-minutes';
import type { EngineInput, EngineOrder, EngineVehicle, Trip, TripDraft } from '../types';

export interface Lookups {
  orderById: ReadonlyMap<string, EngineOrder>;
  vehicleById: ReadonlyMap<string, EngineVehicle>;
}

export function buildLookups(input: EngineInput): Lookups {
  return {
    orderById: new Map(input.orders.map((o) => [o.id, o])),
    vehicleById: new Map(input.vehicles.map((v) => [v.id, v])),
  };
}

export function tripKeyOf(vehicleCode: string, tripNo: number): string {
  return `${vehicleCode}#${tripNo}`;
}

/**
 * Totals for a proposed trip, from its orders and the input tables. validate() always measures, so a
 * plan edited in the UI cannot carry stale numbers. `where` names the trip in error messages, for
 * example "plan.trips[2]".
 */
export function measureTrip(input: EngineInput, lookups: Lookups, draft: TripDraft, where = 'trip'): Trip {
  const vehicle = lookups.vehicleById.get(draft.vehicleId);
  if (!vehicle) {
    throw new EngineInputError({
      code: 'UNKNOWN_VEHICLE',
      field: `${where}.vehicleId`,
      value: draft.vehicleId,
      reason: 'is not in input.vehicles',
    });
  }
  const district = input.districts[draft.districtId];
  if (!district) {
    throw new EngineInputError({
      code: 'UNKNOWN_DISTRICT',
      field: `${where}.districtId`,
      value: draft.districtId,
      reason: 'is not in input.districts',
    });
  }

  let weightKg = 0;
  let volumeM3 = 0;
  const dockTypes = draft.orderIds.map((id, position) => {
    const order = lookups.orderById.get(id);
    if (!order) {
      throw new EngineInputError({
        code: 'UNKNOWN_ORDER',
        field: `${where}.orderIds[${position}]`,
        value: id,
        reason: 'is not in input.orders',
      });
    }
    const outlet = input.outlets[order.outletId];
    if (!outlet) {
      throw new EngineInputError({
        code: 'UNKNOWN_OUTLET',
        field: `input.orders[${JSON.stringify(order.id)}].outletId`,
        value: order.outletId,
        reason: 'is not in input.outlets',
      });
    }
    weightKg += order.weightKg;
    volumeM3 += order.volumeM3;
    return outlet.dockType;
  });

  const km = tripKm(district, draft.orderIds.length);
  const trip: Trip = {
    key: draft.key ?? tripKeyOf(vehicle.code, draft.tripNo),
    vehicleId: draft.vehicleId,
    tripNo: draft.tripNo,
    brand: draft.brand,
    districtId: draft.districtId,
    orderIds: draft.orderIds,
    minutes: tripMinutes({ district, brand: draft.brand, dockTypes, allowances: input.allowances }),
    km,
    litres: tripLitres(km, vehicle.kmPerL),
    weightKg,
    volumeM3,
  };
  if (draft.departMin !== undefined) trip.departMin = draft.departMin;
  return trip;
}
