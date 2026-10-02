import type { CantRunReason, DeliveryOutcome } from '@waypoint/shared';

/**
 * What execution puts on the outbox, versioned so a consumer can tell the
 * shapes apart (specs/execution/spec.md, Events). Every payload carries ids
 * and the few fields consumers need: never a receiver's name, a phone number
 * or anything else personal, because these rows reach SSE and webhooks.
 *
 * Routing: `aggregate: ['trip', tripId]` or `['stop', stopId]`, the trip's
 * `depotId`, and the stop's `outletIds`, so 19 and the store's own screens
 * each hear what belongs to them.
 */

/** trip.downloaded: the phone holds the bundle, so D1 can go offline. */
export type TripDownloadedEvent = {
  v: 1;
  tripId: string;
  depotId: string;
  bundleVersion: number;
  bundleHash: string;
};

/** trip.started: realtime draws the vehicle, tracking starts its ETA clock. */
export type TripStartedEvent = {
  v: 1;
  tripId: string;
  vehicleId: string;
  depotId: string;
  stops: number;
  reeferTempC: number | null;
};

/** stop.arrived: 19a's actual arrival, and the service clock for the next ETA. */
export type StopArrivedEvent = {
  v: 1;
  tripId: string;
  stopId: string;
  orderId: string;
  outletId: string;
  seq: number | null;
  outOfSequence: boolean;
};

/**
 * stop.completed: DELIVERED and PARTIAL. Receipt opens M5 from it, and
 * notifications send the store its proof of delivery, so the payload names
 * the order rather than describing the delivery.
 */
export type StopCompletedEvent = {
  v: 1;
  tripId: string;
  stopId: string;
  orderId: string;
  outletId: string;
  outcome: Extract<DeliveryOutcome, 'DELIVERED' | 'PARTIAL'>;
  unitsDelivered: number | null;
};

/** stop.failed: alerts raises FAILED_STOP, planning may re-queue the order. */
export type StopFailedEvent = {
  v: 1;
  tripId: string;
  stopId: string;
  orderId: string;
  outletId: string;
  outcome: Extract<DeliveryOutcome, 'REFUSED' | 'DAMAGED' | 'OUTLET_CLOSED'>;
};

/** trip.completed: the day's result for 21, and the phone stops watching. */
export type TripCompletedEvent = {
  v: 1;
  tripId: string;
  vehicleId: string;
  depotId: string;
  stopsDelivered: number;
  stopsFailed: number;
};

/**
 * trip.cant_run: the dispatcher's DRIVER_CANT_RUN alert and planning's repair
 * suggestion both start here. The trip keeps its vehicle and driver until a
 * reassign, so the payload says what broke, not what to do about it.
 */
export type TripCantRunEvent = {
  v: 1;
  tripId: string;
  vehicleId: string;
  depotId: string;
  driverId: string | null;
  reason: CantRunReason;
  startedAlready: boolean;
};

export type ExecutionEvent =
  | TripDownloadedEvent
  | TripStartedEvent
  | StopArrivedEvent
  | StopCompletedEvent
  | StopFailedEvent
  | TripCompletedEvent
  | TripCantRunEvent;
