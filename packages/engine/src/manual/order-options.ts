import { EngineInputError } from '../errors';
import { tripKeyOf } from '../plan/measure';
import { preparePlan } from '../plan/prepare';
import { unplannedOrders } from '../plan/unplanned';
import { effectiveWindow } from '../plan/window';
import { priorityOf } from '../priority';
import type { EngineInput, EngineOrder, Plan, Violation } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { validate } from '../validate';
import { applyOps } from './apply-edits';
import type { EditOp } from './edit-ops';
import { evaluateEdits, type TripTotals } from './fits';

export type OptionStatus = 'FITS' | 'WARNING' | 'BLOCKED';

export interface OrderOption {
  orderId: string;
  ref: string;
  status: OptionStatus;
  priority: number;
  /** Why it is dimmed: the hard violations it would cause. Empty unless BLOCKED. */
  blocking: Violation[];
  /** Soft violations it would cause. */
  warnings: Violation[];
  /** The trip with this order on it. */
  result: TripTotals;
}

export interface TripTarget {
  vehicleId: string;
  tripNo: number;
  /** Orders already chosen in the wizard. The first one fixes the brand and district of a new trip. */
  selectedOrderIds?: readonly string[];
}

const RANK: Record<OptionStatus, number> = { FITS: 0, WARNING: 1, BLOCKED: 2 };

/**
 * The orders that could go on this trip, best first: those that fit, then those that fit with a
 * warning, then the blocked ones with their reason. Within a group the higher priority comes first,
 * then the earlier window, then the ref. Only unplanned orders (on no trip) are offered.
 *
 * With no trip yet and nothing chosen, each order is tried as a trip of its own, which is what
 * screen 07 shows before the first pick. With orders chosen, the trip so far is the baseline, so an
 * option is blocked only for what it adds.
 */
export function optionsForTrip(input: EngineInput, plan: Plan, target: TripTarget): OrderOption[] {
  const prepared = preparePlan(input, plan);
  const { params, lookups } = prepared;

  const vehicle = lookups.vehicleById.get(target.vehicleId);
  if (!vehicle) {
    throw new EngineInputError({ code: 'UNKNOWN_VEHICLE', field: 'target.vehicleId', value: target.vehicleId, reason: 'is not in input.vehicles' });
  }
  const tripKey = tripKeyOf(vehicle.code, target.tripNo);
  if (input.fixedTrips.some((t) => t.key === tripKey)) {
    throw new EngineInputError({ code: 'FIXED_TRIP', field: 'target.tripNo', value: tripKey, reason: 'is a released or in-progress trip and cannot be edited here' });
  }

  const assigned = new Set(prepared.trips.flatMap((t) => t.orderIds));
  const selected = target.selectedOrderIds ?? [];
  const chosen: EngineOrder[] = selected.map((id, i) => {
    const order = lookups.orderById.get(id);
    if (!order) throw new EngineInputError({ code: 'UNKNOWN_ORDER', field: `target.selectedOrderIds[${i}]`, value: id, reason: 'is not in input.orders' });
    if (assigned.has(id)) {
      throw new EngineInputError({ code: 'ORDER_ALREADY_ASSIGNED', field: `target.selectedOrderIds[${i}]`, value: id, reason: 'is already on a trip' });
    }
    return order;
  });

  const pool = unplannedOrders(input, plan).filter((o) => !selected.includes(o.id));
  const exists = prepared.trips.some((t) => t.key === tripKey);
  const first = chosen[0];
  const assign = (orderId: string): EditOp => ({ op: 'ASSIGN_ORDER', orderId, tripKey });
  const addTrip = (o: EngineOrder): EditOp => ({ op: 'ADD_TRIP', vehicleId: vehicle.id, tripNo: target.tripNo, brand: o.brand, districtId: o.districtId });

  let options: OrderOption[];
  const option = (order: EngineOrder, base: Plan, before: readonly Violation[], edits: EditOp[]): OrderOption => {
    const r = evaluateEdits(input, base, before, edits, tripKey);
    return {
      orderId: order.id,
      ref: order.ref,
      status: r.blocking.length > 0 ? 'BLOCKED' : r.warnings.length > 0 ? 'WARNING' : 'FITS',
      priority: priorityOf(input, order, params),
      blocking: r.blocking,
      warnings: r.warnings,
      result: r.result,
    };
  };

  if (exists || first) {
    const setup: EditOp[] = [...(exists ? [] : first ? [addTrip(first)] : []), ...selected.map(assign)];
    const base = applyOps(input, plan, setup);
    const before = validate(input, base);
    options = pool.map((o) => option(o, base, before, [assign(o.id)]));
  } else {
    const before = validate(input, plan);
    options = pool.map((o) => option(o, plan, before, [addTrip(o), assign(o.id)]));
  }

  const closeOf = (id: string) => {
    const outlet = input.outlets[lookups.orderById.get(id)?.outletId ?? ''];
    return outlet ? effectiveWindow(outlet).closeMin : Number.POSITIVE_INFINITY;
  };
  return stableSort(
    options,
    (a, b) =>
      RANK[a.status] - RANK[b.status] ||
      b.priority - a.priority ||
      closeOf(a.orderId) - closeOf(b.orderId) ||
      compareText(a.ref, b.ref) ||
      compareText(a.orderId, b.orderId),
  );
}
