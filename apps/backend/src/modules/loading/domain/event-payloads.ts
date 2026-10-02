import { z } from 'zod';

/**
 * What LoadListBuilder reads out of each event it consumes
 * (specs/loading/spec.md, Events: `plan.published`, `plan.revised`,
 * `trip.reassigned`).
 *
 * These are wire contracts, not shared types. The relay hands over an outbox
 * row, and every field is parsed before it is trusted: a payload that does
 * not match its schema is logged and dropped rather than thrown, because a
 * producer's mistake must not stop the relay or lose the events behind it.
 * Unlisted fields are ignored, so planning may send more at any time.
 */

/** Every payload is versioned (architecture: typed versioned payloads). */
const versioned = z.object({ v: z.number().int().positive() });

const uuid = z.string().uuid();
const code = z.string().min(1).max(64);

/**
 * plan.published and plan.revised (planning). The spec gives the payload as
 * "revision, tripIds", so those two are required; everything else is
 * optional and the builder reads the trips themselves for the rest.
 *
 * A revision names only the trips it touched, which is what keeps a one-trip
 * edit from re-stamping a whole depot's lists (AC-LOD-13).
 */
export const planEventPayload = versioned.extend({
  planId: uuid.optional(),
  depotId: code.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  revision: z.number().int().nonnegative(),
  tripIds: z.array(uuid).min(1),
  /** Why the plan was revised; shown on L2's Plan updated banner. */
  reasonCode: z.string().min(1).max(64).optional(),
  note: z.string().max(2000).nullish(),
});
export type PlanEvent = z.infer<typeof planEventPayload>;

/**
 * trip.reassigned (planning). A trip that moved to another *vehicle* has to
 * be loaded again, so the builder refreshes its list and asks planning to
 * put it back in LOADING; one that only changed driver keeps its list and
 * its checks (AC-LOD-19).
 *
 * `vehicleChanged` is how the builder tells the two apart. Planning's spec
 * does not name the field, so when it is absent the builder compares the
 * payload's `vehicleId` with the trip's, and treats a reassign it cannot
 * read either way as a driver change — the safer reading, because it keeps
 * a released trip released rather than sending a loaded vehicle back to the
 * dock on a guess.
 */
export const tripReassignedPayload = versioned.extend({
  tripId: uuid,
  planId: uuid.optional(),
  depotId: code.optional(),
  vehicleId: code.optional(),
  driverId: code.nullish(),
  vehicleChanged: z.boolean().optional(),
  reasonCode: z.string().min(1).max(64).optional(),
});
export type TripReassignedEvent = z.infer<typeof tripReassignedPayload>;

/**
 * One outbox row as the relay hands it over, the same shape alerts takes.
 * `depotId` is the row's routing depot rather than a payload field, because
 * that is where every producer already puts it.
 */
export interface DeliveredEvent {
  /** The outbox_events id, which is also the listener's dedupe key. */
  id: string;
  type: string;
  depotId: string | null;
  payload: unknown;
  occurredAt: Date;
}

/** A parsed payload, or the reason it could not be read. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parsePayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): Parsed<T> {
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    reason: result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; '),
  };
}
