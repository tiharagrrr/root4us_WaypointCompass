import {
  applyEdits,
  optionsForTrip,
  planSchedule,
  tripKeyOf,
  type EditOp,
  type EngineInput,
  type OrderOption,
  type Plan,
  type ScheduledTrip,
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
}

/**
 * Runs the engine in the browser over the plan's context, the same functions the API runs
 * (AC-PLN-12): the draft's edits applied, the trip scheduled stop by stop, and every unplanned
 * order tried against it.
 */
export function previewDraft(input: EngineInput, plan: Plan, draft: TripDraft): DraftPreview {
  const next = applyEdits(input, plan, editsFor(input, plan, draft)).plan
  const key = keyOf(draft)
  const trip = draft.orderIds.length ? planSchedule(input, next).find((t) => t.key === key) : undefined
  const options = optionsForTrip(input, next, { vehicleId: draft.vehicleId, tripNo: draft.tripNo })
  return { trip, options }
}
