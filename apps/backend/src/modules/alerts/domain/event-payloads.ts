import { z } from 'zod';

/**
 * What alerts reads out of each event it consumes.
 *
 * Alerts imports no other module (specs/alerts/spec.md, depends-on), so these
 * are wire contracts, not shared types: the relay hands over an outbox row and
 * every field is parsed before it is trusted. A payload that does not match
 * its schema is logged and dropped rather than thrown, because a producer's
 * mistake must not stop the relay or lose the events behind it.
 *
 * Most of the producing specs say only "ids" or "fields not given" for these
 * payloads, so the schemas below are the fields alerts needs, kept as small
 * as the rules allow. Unlisted fields are ignored, so a producer may send
 * more at any time; `optional()` marks what alerts can do without, and each
 * such case says in `alert-rules.ts` what it falls back to.
 */

/** Every payload is versioned (architecture: typed versioned payloads). */
const versioned = z.object({ v: z.number().int().positive() });

const uuid = z.string().uuid();
/** An outlet or depot id is a natural text key (OUT014, PLG), not a UUID. */
const code = z.string().min(1).max(64);
const instant = z.coerce.date();

/**
 * eta.updated (execution/tracking). `lateRisk` is the probability the stop
 * misses its window, which tracking computes; alerts only compares it with
 * `tracking.lateRiskThreshold` and never recomputes it.
 */
export const etaUpdatedPayload = versioned.extend({
  tripId: uuid,
  stopId: uuid,
  orderId: uuid.optional(),
  outletId: code.optional(),
  lateRisk: z.number().min(0).max(1),
  /** Where the ETA now falls; shown on the alert, not used to decide. */
  etaAt: instant.optional(),
  /** Minutes past the window's close, negative while still inside it. */
  minutesLate: z.number().optional(),
});

/** stop.failed (execution). The outcome says why the delivery did not happen. */
export const stopFailedPayload = versioned.extend({
  tripId: uuid,
  stopId: uuid,
  orderId: uuid,
  outletId: code,
  outcome: z.string().min(1).max(40),
});

/** stop.completed (execution): DELIVERED or PARTIAL, which clears late risk. */
export const stopCompletedPayload = versioned.extend({
  tripId: uuid,
  stopId: uuid,
});

/** stop.deferred (planning): the stop came off the run. */
export const stopDeferredPayload = versioned.extend({
  tripId: uuid.optional(),
  stopId: uuid,
  orderId: uuid.optional(),
});

/**
 * load.flag_raised (loading). `plannedDepartAt` is what decides severity: a
 * shortfall on a trip leaving within half an hour is critical. Loading's spec
 * does not name it, so it is optional, and without it the alert stays a
 * warning rather than guessing (AC-ALR-05).
 */
export const loadFlagRaisedPayload = versioned.extend({
  flagId: uuid,
  tripId: uuid,
  orderId: uuid.optional(),
  outletId: code.optional(),
  reason: z.string().min(1).max(40).optional(),
  plannedDepartAt: instant.optional(),
});

/** load.flag_decided (loading): REPLACE or REMOVE, which closes the alert. */
export const loadFlagDecidedPayload = versioned.extend({
  flagId: uuid,
  tripId: uuid.optional(),
});

/**
 * issue.reported (receipt). A TEMPERATURE issue is a warning; every other
 * kind is information, because the cold chain is the only one that spoils
 * while the dispatcher reads the list (AC-ALR-06).
 */
export const issueReportedPayload = versioned.extend({
  issueId: uuid,
  type: z.string().min(1).max(40),
  outletId: code,
  orderId: uuid.optional(),
  stopId: uuid.optional(),
  /** The person who reported it, kept on the alert so 01 can say who. */
  raisedById: z.string().min(1).max(64).optional(),
});

export const issueResolvedPayload = versioned.extend({ issueId: uuid });

/** trip.cant_run (execution): the driver cannot drive this trip. */
export const tripCantRunPayload = versioned.extend({
  tripId: uuid,
  vehicleId: uuid.optional(),
  driverId: z.string().min(1).max(64).nullish(),
  reason: z.string().min(1).max(40).optional(),
  startedAlready: z.boolean().optional(),
});

/** trip.reassigned and trip.cancelled (planning): the can't-run is answered. */
export const tripPayload = versioned.extend({ tripId: uuid });

/**
 * vehicle.offline and vehicle.back_online (execution's tracking). Keyed on
 * the trip, as the catalog's dedupe key says: the dispatcher cares about the
 * run that has gone quiet, and the same vehicle on tomorrow's trip is a new
 * problem (specs/alerts/spec.md, Open questions).
 */
export const vehicleSignalPayload = versioned.extend({
  tripId: uuid,
  vehicleId: uuid.optional(),
  /** Minutes since the last ping, which the alert shows. */
  minutesSilent: z.number().optional(),
});

/**
 * deferral.store_responded (planning). The store either acknowledges or asks
 * for priority; only the second raises an alert, so the flag must be present
 * for the rule to fire.
 */
export const deferralRespondedPayload = versioned.extend({
  deferralId: uuid,
  orderId: uuid.optional(),
  outletId: code.optional(),
  priorityRequested: z.boolean(),
  note: z.string().max(2000).optional(),
  respondedById: z.string().min(1).max(64).optional(),
});

/** deferral.confirmed (planning): the dispatcher has answered. */
export const deferralConfirmedPayload = versioned.extend({
  deferralId: uuid,
  orderId: uuid.optional(),
  stopId: uuid.optional(),
});

/** sync.conflict_detected and sync.conflict_resolved (sync), for 19c. */
export const syncConflictPayload = versioned.extend({
  conflictId: uuid,
  tripId: uuid.optional(),
  stopId: uuid.optional(),
  kind: z.string().min(1).max(40).optional(),
});

export type EtaUpdated = z.infer<typeof etaUpdatedPayload>;
export type LoadFlagRaised = z.infer<typeof loadFlagRaisedPayload>;
export type IssueReported = z.infer<typeof issueReportedPayload>;
export type TripCantRun = z.infer<typeof tripCantRunPayload>;
export type VehicleSignal = z.infer<typeof vehicleSignalPayload>;
export type DeferralResponded = z.infer<typeof deferralRespondedPayload>;
