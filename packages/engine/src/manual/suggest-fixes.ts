import { EngineInputError } from '../errors';
import { tripKeyOf } from '../plan/measure';
import { preparePlan } from '../plan/prepare';
import { unplannedOrders } from '../plan/unplanned';
import { priorityOf } from '../priority';
import type { EngineInput, EngineOrder, Plan, Trip, Violation } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { validate } from '../validate';
import { applyOps } from './apply-edits';
import type { EditOp } from './edit-ops';
import { violationKey } from './violation-key';

export type FixKind = 'MOVE' | 'SWAP' | 'DEFER';

export interface FixSuggestion {
  kind: FixKind;
  /** For the dispatcher, for example "Move WF-0171 to REF-03 trip 1". */
  label: string;
  /** Apply these with applyEdits() or POST /edits. */
  edits: EditOp[];
  /** Soft violations the fix would cause. It never causes a hard one. */
  introduced: Violation[];
}

const KIND_RANK: Record<FixKind, number> = { MOVE: 0, SWAP: 1, DEFER: 2 };

type SortKey = (number | string)[];

interface Candidate extends FixSuggestion {
  sortKey: SortKey;
}

const compareKeys = (a: SortKey, b: SortKey): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return typeof x === 'number' && typeof y === 'number' ? x - y : compareText(String(x), String(y));
  }
  return 0;
};

/**
 * Ranked ways to clear a hard violation: move an order to another vehicle (or another trip), swap
 * it for an unplanned order of at least its priority, or defer the lowest-priority order. Every
 * suggestion is tried with validate(): it must clear the violation and cause no new hard one. Moves
 * come first, then swaps, then deferrals; within a kind the least disruptive wins (fewest edits,
 * lowest-priority and smallest order, the earliest trip number). A soft violation, or one with no
 * trip or vehicle to fix (a whole-order or operating-day finding), has no suggestions.
 */
export function suggestFixes(input: EngineInput, plan: Plan, violation: Violation, limit = 5): FixSuggestion[] {
  if (violation.severity !== 'HARD') return [];
  const prepared = preparePlan(input, plan);
  const { params, lookups } = prepared;
  const fixedKeys = new Set(input.fixedTrips.map((t) => t.key));
  const editable = prepared.trips.filter((t) => !fixedKeys.has(t.key));

  const offending = violation.tripKey
    ? editable.filter((t) => t.key === violation.tripKey)
    : violation.vehicleId
      ? editable.filter((t) => t.vehicleId === violation.vehicleId)
      : [];
  if (offending.length === 0) return [];

  const priority = new Map<string, number>();
  const prio = (o: EngineOrder) => {
    const cached = priority.get(o.id);
    if (cached !== undefined) return cached;
    const p = priorityOf(input, o, params);
    priority.set(o.id, p);
    return p;
  };

  // The orders that could be changed to clear it, each with the trip it is on.
  const onTrips: { order: EngineOrder; trip: Trip }[] = offending.flatMap((trip) =>
    trip.orderIds.flatMap((id) => {
      const order = lookups.orderById.get(id);
      return order && (!violation.orderId || violation.orderId === id) ? [{ order, trip }] : [];
    }),
  );
  const leastFirst = (a: { order: EngineOrder }, b: { order: EngineOrder }) =>
    prio(a.order) - prio(b.order) || a.order.volumeM3 - b.order.volumeM3 || a.order.weightKg - b.order.weightKg || compareText(a.order.id, b.order.id);
  const candidates = stableSort(onTrips, leastFirst);

  const before = validate(input, plan);
  const beforeKeys = new Set(before.map(violationKey));
  const target = violationKey(violation);

  /** The edits' effect, or null when they cannot be applied or do not fix it cleanly. */
  const attempt = (edits: EditOp[]): Violation[] | null => {
    try {
      const after = validate(input, applyOps(input, plan, edits));
      if (after.some((v) => violationKey(v) === target)) return null;
      const introduced = after.filter((v) => !beforeKeys.has(violationKey(v)));
      return introduced.some((v) => v.severity === 'HARD') ? null : introduced;
    } catch (e) {
      if (e instanceof EngineInputError) return null;
      throw e;
    }
  };

  const found: Candidate[] = [];
  const keys = new Set<string>();
  const add = (kind: FixKind, label: string, edits: EditOp[], rest: SortKey) => {
    const id = JSON.stringify(edits);
    if (keys.has(id)) return;
    const introduced = attempt(edits);
    if (introduced === null) return;
    keys.add(id);
    found.push({ kind, label, edits, introduced, sortKey: [KIND_RANK[kind], edits.length, ...rest] });
  };
  const small = (o: EngineOrder): SortKey => [prio(o), o.volumeM3, o.weightKg];

  // MOVE: onto a trip the vehicle already has, or onto a new trip on it.
  const vehicles = stableSort(input.vehicles, (a, b) => compareText(a.code, b.code) || compareText(a.id, b.id));
  for (const { order, trip } of candidates) {
    for (const vehicle of vehicles) {
      const own = prepared.trips.filter((t) => t.vehicleId === vehicle.id);
      for (const t of own) {
        if (fixedKeys.has(t.key) || t.key === trip.key || t.brand !== trip.brand || t.districtId !== trip.districtId) continue;
        add('MOVE', `Move ${order.ref} to ${vehicle.code} trip ${t.tripNo}`, [{ op: 'MOVE_ORDER', orderId: order.id, tripKey: t.key }], [...small(order), t.tripNo, vehicle.code, order.id]);
      }
      const used = new Set(own.map((t) => t.tripNo));
      for (let n = 1; n <= params.maxTripsPerVehicle; n++) {
        if (used.has(n)) continue;
        const key = tripKeyOf(vehicle.code, n);
        add(
          'MOVE',
          `Move ${order.ref} to ${vehicle.code} trip ${n}`,
          [
            { op: 'ADD_TRIP', vehicleId: vehicle.id, tripNo: n, brand: trip.brand, districtId: trip.districtId },
            { op: 'MOVE_ORDER', orderId: order.id, tripKey: key },
          ],
          [...small(order), n, vehicle.code, order.id],
        );
        break; // the smallest free number is enough
      }
    }
  }

  // SWAP: an unplanned order of at least the same priority takes its place.
  const unplanned = stableSort(unplannedOrders(input, plan), (a, b) => prio(b) - prio(a) || compareText(a.id, b.id));
  for (const { order, trip } of candidates) {
    for (const other of unplanned) {
      if (prio(other) < prio(order)) continue;
      add(
        'SWAP',
        `Swap ${order.ref} for ${other.ref}`,
        [{ op: 'UNASSIGN_ORDER', orderId: order.id }, { op: 'ASSIGN_ORDER', orderId: other.id, tripKey: trip.key }],
        [...small(order), -prio(other), order.id, other.id],
      );
    }
  }

  // DEFER: the lowest-priority order that clears it; or, when no single order does, the lowest first
  // until it is cleared.
  for (const { order } of candidates) {
    add('DEFER', `Defer ${order.ref}`, [{ op: 'UNASSIGN_ORDER', orderId: order.id }], [...small(order), order.id]);
  }
  if (!found.some((f) => f.kind === 'DEFER') && candidates.length > 1) {
    for (let n = 2; n <= candidates.length; n++) {
      const group = candidates.slice(0, n);
      const edits: EditOp[] = group.map(({ order }) => ({ op: 'UNASSIGN_ORDER', orderId: order.id }));
      add('DEFER', `Defer ${group.map(({ order }) => order.ref).join(', ')}`, edits, [...small(group[0]?.order ?? candidates[0]?.order as EngineOrder), group.length]);
      if (found.some((f) => f.kind === 'DEFER')) break;
    }
  }

  return stableSort(found, (a, b) => compareKeys(a.sortKey, b.sortKey))
    .slice(0, limit)
    .map(({ kind, label, edits, introduced }) => ({ kind, label, edits, introduced }));
}
