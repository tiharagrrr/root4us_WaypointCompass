import type {
  LoadFlagDecision,
  LoadFlagReason,
  LoadFlagStatus,
  LoadLineStatus,
} from '@waypoint/shared';

/**
 * The payloads loading puts on the outbox (specs/loading/spec.md, Events).
 * Every one carries `v: 1`, so a consumer can tell versions apart, and only
 * ids and the few fields a consumer needs to act — never a typed Checked-by
 * name, which is personal data and stays in the row and its audit trail.
 *
 * The consumers these shapes are fixed by:
 *
 * - **alerts** parses `load.flag_raised` for `flagId`, `tripId`, `reason` and
 *   `plannedDepartAt` (it raises LOADER_SHORTFALL, critical when the trip
 *   leaves within half an hour) and `load.flag_decided` for `flagId`, which
 *   closes the alert (AC-ALR-05).
 * - **realtime** keys L2's Plan updated banner on `load.list_updated`, and
 *   L3b and L3c on `load.flag_decided` and `load.flag_resolved`; the spec
 *   says `load.flag_decided` carries `tripId`, because the web invalidates
 *   `['load-list', tripId]` on it.
 * - **notifications** pushes `load.flag_raised` to the depot's dispatchers,
 *   tells the store when a REMOVE defers part of its order, and SMSes the
 *   driver on `trip.released`.
 * - **execution** and **webhooks** take `trip.released`.
 */

export interface LoadListUpdatedEvent {
  v: 1;
  tripId: string;
  planId: string;
  depotId: string;
  /** The revision the list now carries. */
  revision: number;
  lines: number;
  added: number;
  removed: number;
  /** Checks a refresh kept, which is what makes the banner reassuring. */
  keptChecks: number;
  /** The trip went back to LOADING after its vehicle changed (AC-LOD-19). */
  reopened: boolean;
  reasonCode: string | null;
}

export interface LoadLineCheckedEvent {
  v: 1;
  tripId: string;
  loadLineId: string;
  orderId: string;
  outletId: string;
  status: LoadLineStatus;
  qtyExpected: number;
  qtyLoaded: number | null;
  stopSeq: number;
}

export interface LoadFlagRaisedEvent {
  v: 1;
  flagId: string;
  tripId: string;
  loadLineId: string;
  orderId: string;
  outletId: string;
  reason: LoadFlagReason;
  qtyAffected: number;
  /** What alerts reads to decide whether a shortfall is critical. */
  plannedDepartAt: string | null;
}

export interface LoadFlagDecidedEvent {
  v: 1;
  flagId: string;
  tripId: string;
  loadLineId: string;
  orderId: string;
  outletId: string;
  decision: LoadFlagDecision;
  reasonCode: string | null;
  /** Set on a REMOVE: the deferral and the backorder it created. */
  deferralId: string | null;
  backorderId: string | null;
  /** The plan's revision after a REMOVE bumped it. */
  revision: number;
}

export interface LoadFlagResolvedEvent {
  v: 1;
  flagId: string;
  tripId: string;
  loadLineId: string;
  status: LoadFlagStatus;
  /** How it closed: the dispatcher's decision, a re-check, or the raiser. */
  how: 'RECHECK' | 'REMOVE' | 'UNDONE';
  qtyLoaded: number | null;
}

export interface TripReleasedEvent {
  v: 1;
  tripId: string;
  planId: string;
  depotId: string;
  vehicleId: string;
  driverId: string | null;
  /** How many stops the driver is about to run, for the SMS. */
  stops: number;
  orderIds: string[];
  releaseTempC: number | null;
  releasedAt: string;
  /** The first stop's planned arrival, which the driver's SMS quotes. */
  firstStopAt: string | null;
}

export type LoadingEvent =
  | LoadListUpdatedEvent
  | LoadLineCheckedEvent
  | LoadFlagRaisedEvent
  | LoadFlagDecidedEvent
  | LoadFlagResolvedEvent
  | TripReleasedEvent;
