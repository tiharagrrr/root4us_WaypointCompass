import {
  applyEdits,
  optionsForTrip,
  planSchedule,
  suggestFixes,
  tripKeyOf,
  type EditOp,
  type EngineInput,
  type FixSuggestion,
  type OrderOption,
  type Plan,
  type ScheduledTrip,
  type Violation,
} from '@waypoint/engine'

/** The trip the wizard is building or editing: a vehicle, a trip number and its orders in stop order. */
export interface TripDraft {
  vehicleId: string
  vehicleCode: string
  tripNo: number
  orderIds: readonly string[]
}

const keyOf = (draft: Pick<TripDraft, 'vehicleCode' | 'tripNo'>) => tripKeyOf(draft.vehicleCode, draft.tripNo)

/** The orders the saved plan already has on this trip, in stop order. */
export function savedOrders(plan: Plan, draft: Pick<TripDraft, 'vehicleCode' | 'vehicleId' | 'tripNo'>): string[] {
  const trip = plan.trips.find((t) => t.vehicleId === draft.vehicleId && t.tripNo === draft.tripNo)
  return trip ? [...trip.orderIds] : []
}

/**
 * The edit list that turns the saved plan's trip into the draft: ADD_TRIP and its orders for a new
 * trip (08 saves them as one list, AC-PLN-13), or the removals, additions and the new stop order
 * for a trip already on the plan. The brand and district come from the first order.
 */
export function editsFor(input: EngineInput, plan: Plan, draft: TripDraft): EditOp[] {
  const tripKey = keyOf(draft)
  const saved = savedOrders(plan, draft)
  const ops: EditOp[] = []
  if (saved.length === 0) {
    const first = input.orders.find((o) => o.id === draft.orderIds[0])
    if (!first) return []
    ops.push({ op: 'ADD_TRIP', vehicleId: draft.vehicleId, tripNo: draft.tripNo, brand: first.brand, districtId: first.districtId })
    for (const orderId of draft.orderIds) ops.push({ op: 'ASSIGN_ORDER', orderId, tripKey })
    return ops
  }
  if (draft.orderIds.length === 0) return [{ op: 'REMOVE_TRIP', tripKey }]
  for (const orderId of saved) if (!draft.orderIds.includes(orderId)) ops.push({ op: 'UNASSIGN_ORDER', orderId })
  for (const orderId of draft.orderIds) if (!saved.includes(orderId)) ops.push({ op: 'ASSIGN_ORDER', orderId, tripKey })
  if (ops.length || saved.join('|') !== draft.orderIds.join('|')) ops.push({ op: 'RESEQUENCE', tripKey, orderIds: [...draft.orderIds] })
  return ops
}

export interface DraftPreview {
  /** The trip as the engine measures and times it, or undefined while it has no orders. */
  trip: ScheduledTrip | undefined
  /** The orders 07 lists for this trip: fits first, then warnings, then blocked with why. */
  options: OrderOption[]
  /** Every trip of the draft's vehicle, scheduled, for the trip list on 10. */
  vehicleTrips: ScheduledTrip[]
  /** The hard violations on the draft's vehicle after the draft's edits (10, 11). */
  problems: Violation[]
  /** The plan after the draft's edits, which a fix is worked out against. */
  next: Plan
}

/**
 * Runs the engine in the browser over the plan's context, the same functions the API runs
 * (AC-PLN-12): the draft's edits applied, the trip scheduled stop by stop, and every unplanned
 * order tried against it.
 */
export function previewDraft(input: EngineInput, plan: Plan, draft: TripDraft): DraftPreview {
  const applied = applyEdits(input, plan, editsFor(input, plan, draft))
  const next = applied.plan
  const key = keyOf(draft)
  const scheduled = planSchedule(input, next)
  const trip = draft.orderIds.length ? scheduled.find((t) => t.key === key) : undefined
  const options = optionsForTrip(input, next, { vehicleId: draft.vehicleId, tripNo: draft.tripNo })
  const vehicleTrips = scheduled.filter((t) => t.vehicleId === draft.vehicleId).sort((a, b) => a.tripNo - b.tripNo)
  const keys = new Set(vehicleTrips.map((t) => t.key))
  const problems = applied.violations.filter(
    (v) => v.severity === 'HARD' && ((v.tripKey && keys.has(v.tripKey)) || (!v.tripKey && v.vehicleId === draft.vehicleId)),
  )
  return { trip, options, vehicleTrips, problems, next }
}

/** 11: the engine's ranked ways to clear one hard violation, worked out after the draft's edits. */
export function fixesFor(input: EngineInput, next: Plan, violation: Violation): FixSuggestion[] {
  return suggestFixes(input, next, violation)
}
