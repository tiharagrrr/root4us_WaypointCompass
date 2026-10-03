import type { BindingRule } from '../rules/codes';
import { reasonCodeFor, type DeferralReasonCode } from '../rules/reason-map';
import { isRepeatSkip } from '../plan/repeat-skip';
import type { DeferralChoice } from '../rules/codes';
import type {
  EngineOrder,
  EngineVehicle,
  TriedVehicle,
  Trip,
  Unplanned,
  UnplannedDetail,
} from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { round } from '../util/lte';
import { historyOf, outletOf, type AllocContext } from './context';
import { vehicleOf, type FitFailure } from './fits';
import type { RankedOrder } from './priority';

/** The kind of vehicle the order needs, for the sentence explain() writes and for "best room left". */
export type VehicleKind = 'reefer' | 'van' | 'truck';

export function vehicleKindFor(ctx: AllocContext, order: EngineOrder): VehicleKind {
  if (order.tempClass === 'CHILLED') return 'reefer';
  return outletOf(ctx, order).parkingConstraint === 'VAN_ONLY' ? 'van' : 'truck';
}

function isKind(vehicle: EngineVehicle, kind: VehicleKind): boolean {
  if (kind === 'reefer') return vehicle.temp === 'REEFER';
  if (kind === 'van') return vehicle.type === 'VAN';
  return true;
}

/** The unavailable vehicle that best explains an empty fleet: a breakdown first, then the workshop. */
function unavailableVehicle(ctx: AllocContext, order: EngineOrder): EngineVehicle | undefined {
  const depotId = outletOf(ctx, order).depotId;
  const unavailable = stableSort(
    ctx.input.vehicles.filter((v) => !v.available && v.depotId === depotId),
    (a, b) => compareText(a.code, b.code),
  );
  return unavailable.find((v) => v.unavailableReason === 'BREAKDOWN') ?? unavailable[0];
}

/**
 * Why the order has no place: the rule that ruled out the last candidate vehicle tried, mapped to a
 * reason. With no candidate at all the fleet itself is the reason, a breakdown if there was one.
 */
export function reasonForFailure(
  ctx: AllocContext,
  order: EngineOrder,
  lastFailure: FitFailure | null,
): { reasonCode: DeferralReasonCode; bindingRule: BindingRule | null } {
  if (lastFailure?.bindingRule) {
    const vehicleId = lastFailure.violation.vehicleId;
    const vehicle = vehicleId === undefined ? undefined : ctx.lookups.vehicleById.get(vehicleId);
    return { bindingRule: lastFailure.bindingRule, reasonCode: reasonCodeFor(lastFailure.bindingRule, vehicle) };
  }
  const idle = unavailableVehicle(ctx, order);
  if (idle) return { bindingRule: 'VEHICLE_AVAILABLE', reasonCode: reasonCodeFor('VEHICLE_AVAILABLE', idle) };
  return { bindingRule: null, reasonCode: 'OVER_CAPACITY' };
}

/**
 * What the order needed and the most room any trip it could have joined had left: the numbers screen
 * 15 shows. Only trips of its own brand and district on the kind of vehicle it needs can be meant.
 */
export function detailFor(ctx: AllocContext, order: EngineOrder, trips: readonly Trip[]): UnplannedDetail {
  const kind = vehicleKindFor(ctx, order);
  let best: { volumeM3: number; trip: Trip } | null = null;
  for (const trip of trips) {
    if (trip.brand !== order.brand || trip.districtId !== order.districtId) continue;
    const vehicle = vehicleOf(ctx, trip.vehicleId);
    if (!isKind(vehicle, kind)) continue;
    const left = vehicle.volumeCapM3 - trip.volumeM3;
    if (best === null || left > best.volumeM3) best = { volumeM3: left, trip };
  }
  return {
    needUnits: order.units,
    needWeightKg: round(order.weightKg),
    needVolumeM3: round(order.volumeM3),
    bestVolumeM3: best === null ? null : round(best.volumeM3),
    bestTripKey: best?.trip.key ?? null,
    bestVehicleId: best?.trip.vehicleId ?? null,
    bestTripNo: best?.trip.tripNo ?? null,
  };
}

export interface UnplannedInput {
  ranked: RankedOrder;
  /** Every vehicle tried, in the order they were tried. */
  tried: readonly TriedVehicle[];
  lastFailure: FitFailure | null;
  choice: DeferralChoice;
  displacedBy?: string;
}

/** One deferral, with its reason, the rule behind it, the numbers and the repeat-skip flag. */
export function unplannedOf(
  ctx: AllocContext,
  trips: readonly Trip[],
  { ranked, tried, lastFailure, choice, displacedBy }: UnplannedInput,
): Unplanned {
  const { order } = ranked;
  const { reasonCode, bindingRule } = reasonForFailure(ctx, order, lastFailure);
  const unplanned: Unplanned = {
    orderId: order.id,
    reasonCode,
    bindingRule,
    choice,
    priority: ranked.priority,
    repeatSkip: isRepeatSkip(historyOf(ctx, order), ctx.params),
    detail: detailFor(ctx, order, trips),
    tried,
  };
  if (displacedBy !== undefined) return { ...unplanned, displacedBy };
  return unplanned;
}
