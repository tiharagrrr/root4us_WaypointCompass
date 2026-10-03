import type { CantRunReason, DeliveryOutcome, LoadFlagReason, StopEventType } from '@waypoint/shared'

/**
 * What a driver's phone or a dock tablet can queue. One union, discriminated on `type`, mirroring
 * the two server-side readers: execution's `FieldEvent` (StopEventService.apply) and loading's
 * `LoaderEvent` (LoaderEventService.apply).
 *
 * This is the *device* contract. `packages/shared`'s `stopEventSchema` is still the thinner wire
 * contract: it requires a stopId, so it cannot carry the trip-level events, and it has no
 * deviceSeq, baseVersion, lines or attachments. ROO-44 owns widening it along with `POST /sync`;
 * until then `toWireEvent` below sends what today's schema accepts and the rest rides in the
 * outbox row, so nothing a loader or driver tapped is lost.
 */
export type QueuedEvent = DriverEvent | LoaderEvent

export type DriverEventType = StopEventType
export const LOADER_EVENT_TYPES = [
  'LOAD_LINE_CHECKED',
  'LOAD_CHECK_UNDONE',
  'LOAD_FLAG_RAISED',
  'LOAD_FLAG_UNDONE',
  'LOAD_RECHECKED',
] as const
export type LoaderEventType = (typeof LOADER_EVENT_TYPES)[number]

export const LINE_CONDITIONS = ['ok', 'damaged', 'refused'] as const
export type LineCondition = (typeof LINE_CONDITIONS)[number]

/** One order line as the phone recorded it against the stop (D4). */
export interface QueuedLine {
  orderLineId: string
  qtyDelivered: number
  condition: LineCondition
  note?: string
}

interface QueuedBase {
  /** The trip or stop version the device saw. A stale one is a conflict for /sync to resolve. */
  baseVersion?: number
  /** Attachments by their own clientUuid, never by id: the id does not exist yet offline. */
  attachmentUuids?: string[]
  note?: string
}

export interface DriverEvent extends QueuedBase {
  kind: 'driver'
  type: DriverEventType
  tripId: string
  /** Absent on the trip-level events: downloaded, started, completed, can't run. */
  stopId?: string
  outcome?: DeliveryOutcome
  receiverName?: string
  /** D8's reason. */
  reasonCode?: CantRunReason
  lines?: QueuedLine[]
  reeferTempC?: number
  lat?: number
  lng?: number
}

export interface LoaderEvent extends QueuedBase {
  kind: 'loader'
  type: LoaderEventType
  tripId: string
  loadLineId?: string
  loadFlagId?: string
  /**
   * The name typed on the shared tablet. Four loaders share one dock tablet, so the account says
   * whose tablet it is and only this says who looked in the crate (AC-LOD-03).
   */
  checkedByName?: string
  qtyLoaded?: number
  reason?: LoadFlagReason
  qtyAffected?: number
  photoClientUuid?: string
}

/** The trip-level driver events, which carry no stopId. */
const TRIP_LEVEL = new Set<string>(['TRIP_DOWNLOADED', 'TRIP_STARTED', 'TRIP_COMPLETED', 'CANT_RUN'])
export const isTripLevel = (type: string): boolean => TRIP_LEVEL.has(type)

/**
 * `CANT_RUN` is sent on its own the moment there is a connection rather than waiting for the next
 * batch: the dispatcher has to reassign the trip, so it is the one event where a queue would cost
 * the depot a run (AC-EXE-14).
 */
export const isUrgent = (event: QueuedEvent): boolean =>
  event.kind === 'driver' && event.type === 'CANT_RUN'
