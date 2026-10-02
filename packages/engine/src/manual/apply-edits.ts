import { EngineInputError, type EngineInputErrorCode } from '../errors';
import { resolveParams } from '../params';
import { buildLookups, tripKeyOf } from '../plan/measure';
import { preparePlan } from '../plan/prepare';
import { manualUnplanned } from '../plan/unplanned';
import type { EngineInput, Plan, TripDraft, Violation } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { validate } from '../validate';
import type { EditOp } from './edit-ops';
import { violationKey } from './violation-key';

export interface ApplyEditsResult {
  /** The plan after the edits, trips sorted by key. */
  plan: Plan;
  /** Every violation of the new plan. */
  violations: Violation[];
  /** The violations the edits caused: in the new plan, but not in the old one. */
  introduced: Violation[];
}

const fail = (code: EngineInputErrorCode, field: string, value: string, reason: string): never => {
  throw new EngineInputError({ code, field, value, reason });
};

/**
 * Applies the edits in order to a copy of the plan, or throws an EngineInputError naming the edit
 * ("edits[2].tripKey") when one cannot be applied. Whether the result breaks a rule is not checked
 * here: that is validate()'s job, and a violation is returned, never thrown.
 */
export function applyOps(input: EngineInput, plan: Plan, edits: readonly EditOp[]): Plan {
  const lookups = buildLookups(input);
  const fixedKeys = new Set(input.fixedTrips.map((t) => t.key));
  const fixedOrderTrip = new Map(input.fixedTrips.flatMap((t) => t.orderIds.map((id) => [id, t.key] as const)));

  // Working copies, by key. validate() has already refused trips that name unknown vehicles.
  const keyOf = (t: TripDraft) => t.key ?? tripKeyOf(lookups.vehicleById.get(t.vehicleId)?.code ?? t.vehicleId, t.tripNo);
  const trips = new Map<string, TripDraft & { orderIds: string[] }>();
  for (const t of plan.trips) trips.set(keyOf(t), { ...t, orderIds: [...t.orderIds] });

  const tripOf = (orderId: string): string | undefined => {
    for (const [key, t] of trips) if (t.orderIds.includes(orderId)) return key;
    return fixedOrderTrip.get(orderId);
  };
  const orderExists = (i: number, id: string) => {
    if (!lookups.orderById.has(id)) fail('UNKNOWN_ORDER', `edits[${i}].orderId`, id, 'is not in input.orders');
  };
  const editableTrip = (i: number, key: string) => {
    if (fixedKeys.has(key)) fail('FIXED_TRIP', `edits[${i}].tripKey`, key, 'is a released or in-progress trip and cannot be edited here');
    const t = trips.get(key);
    if (!t) return fail('UNKNOWN_TRIP', `edits[${i}].tripKey`, key, 'is not a trip in the plan');
    return t;
  };
  const insert = (i: number, trip: { orderIds: string[] }, key: string, orderId: string, at: number | undefined) => {
    const length = trip.orderIds.length;
    if (at !== undefined && at > length) {
      fail('INVALID_POSITION', `edits[${i}].position`, String(at), `is outside 0 to ${length} for ${key}`);
    }
    trip.orderIds.splice(at ?? length, 0, orderId);
  };

  edits.forEach((edit, i) => {
    switch (edit.op) {
      case 'ADD_TRIP': {
        const vehicle = lookups.vehicleById.get(edit.vehicleId);
        if (!vehicle) fail('UNKNOWN_VEHICLE', `edits[${i}].vehicleId`, edit.vehicleId, 'is not in input.vehicles');
        if (!input.districts[edit.districtId]) fail('UNKNOWN_DISTRICT', `edits[${i}].districtId`, edit.districtId, 'is not in input.districts');
        const key = tripKeyOf(vehicle?.code ?? edit.vehicleId, edit.tripNo);
        if (trips.has(key) || fixedKeys.has(key)) fail('TRIP_EXISTS', `edits[${i}].tripNo`, key, 'is already a trip in the plan');
        trips.set(key, { vehicleId: edit.vehicleId, tripNo: edit.tripNo, brand: edit.brand, districtId: edit.districtId, orderIds: [] });
        break;
      }
      case 'REMOVE_TRIP': {
        editableTrip(i, edit.tripKey);
        trips.delete(edit.tripKey);
        break;
      }
      case 'ASSIGN_ORDER': {
        orderExists(i, edit.orderId);
        const trip = editableTrip(i, edit.tripKey);
        if (tripOf(edit.orderId) !== undefined) {
          fail('ORDER_ALREADY_ASSIGNED', `edits[${i}].orderId`, edit.orderId, `is already on ${tripOf(edit.orderId)}; unassign or move it instead`);
        }
        insert(i, trip, edit.tripKey, edit.orderId, edit.position);
        break;
      }
      case 'UNASSIGN_ORDER':
      case 'MOVE_ORDER': {
        orderExists(i, edit.orderId);
        const from = tripOf(edit.orderId);
        if (from === undefined) fail('ORDER_NOT_ASSIGNED', `edits[${i}].orderId`, edit.orderId, 'is not on any trip');
        const source = trips.get(from ?? '');
        if (!source) fail('FIXED_TRIP', `edits[${i}].orderId`, edit.orderId, `is on ${from}, a released or in-progress trip that cannot be edited here`);
        const target = edit.op === 'MOVE_ORDER' ? editableTrip(i, edit.tripKey) : undefined;
        source?.orderIds.splice(source.orderIds.indexOf(edit.orderId), 1);
        if (edit.op === 'MOVE_ORDER' && target) insert(i, target, edit.tripKey, edit.orderId, edit.position);
        break;
      }
      case 'RESEQUENCE': {
        const trip = editableTrip(i, edit.tripKey);
        const have = new Set(trip.orderIds);
        const given = new Set(edit.orderIds);
        const missing = trip.orderIds.filter((id) => !given.has(id));
        const extra = edit.orderIds.filter((id) => !have.has(id));
        const repeated = edit.orderIds.filter((id, at) => edit.orderIds.indexOf(id) !== at);
        if (missing.length || extra.length || repeated.length) {
          const parts = [
            missing.length ? `missing ${missing.join(', ')}` : '',
            extra.length ? `extra ${extra.join(', ')}` : '',
            repeated.length ? `repeated ${repeated.join(', ')}` : '',
          ].filter((part) => part !== '');
          fail('INVALID_RESEQUENCE', `edits[${i}].orderIds`, edit.orderIds.join(','), `is not the orders on ${edit.tripKey} in a new order: ${parts.join('; ')}`);
        }
        trip.orderIds = [...edit.orderIds];
        break;
      }
    }
  });

  // An order that was on a trip and now is not is unplanned: it goes on the list, with no reason yet.
  const onATrip = new Set([...trips.values()].flatMap((t) => t.orderIds));
  const wasOnATrip = plan.trips.flatMap((t) => t.orderIds);
  const listed = new Set(plan.unplanned.map((u) => u.orderId));
  const params = resolveParams(input.params);
  const added = wasOnATrip.flatMap((id) => {
    const order = lookups.orderById.get(id);
    return order && !onATrip.has(id) && !listed.has(id) ? [manualUnplanned(input, order, params)] : [];
  });
  return {
    trips: stableSort([...trips.entries()], (a, b) => compareText(a[0], b[0])).map(([, t]) => t),
    unplanned: stableSort(
      [...plan.unplanned.filter((u) => !onATrip.has(u.orderId)), ...added],
      (a, b) => compareText(a.orderId, b.orderId),
    ),
  };
}

/**
 * Applies a list of edits to a plan and says what that did: the new plan, every violation, and which
 * of them the edits caused. Pure: the inputs are never changed, and the same edits always give the
 * same answer. The API persists the result; SET_DRIVER and SET_WAVE are its own.
 */
export function applyEdits(input: EngineInput, plan: Plan, edits: readonly EditOp[]): ApplyEditsResult {
  preparePlan(input, plan); // refuse a bad plan or date before touching anything
  const before = validate(input, plan);
  const next = applyOps(input, plan, edits);
  const violations = validate(input, next);
  const seen = new Set(before.map(violationKey));
  return { plan: next, violations, introduced: violations.filter((v) => !seen.has(violationKey(v))) };
}
