import type { Actor } from '@waypoint/shared';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';

/**
 * The channel table in specs/realtime/spec.md. A client never chooses its
 * channels: they come from the actor's role and scope, and an event's from its
 * outbox routing. A stream carries an event when the two sets meet.
 */

/** Every depot, for an admin or a dispatcher with no depot set. */
export const ALL_DEPOTS = 'depot:*';
export const BROADCAST = 'broadcast';
/** Admins follow every account and device change (A1, A2). */
export const ADMINS = 'role:admin';

/**
 * Reach every stream: the demo clock, settings, a demo reset, and a depot's
 * own settings (A4), whose cutoff override the stores it serves count down to.
 */
const BROADCAST_TYPES = new Set([
  'clock.changed',
  'settings.changed',
  'depot.updated',
  'demo.reset',
]);
/** What the dock follows on depot:<id>:loading. */
const LOADING_PREFIXES = ['load.', 'plan.', 'trip.'];
/** Positions draw the map; stores never see it (AC-RT-08). */
export const POSITION_TYPE = 'vehicle.position';

export function channelsFor(actor: Actor, tripIds: readonly string[] = []) {
  const own = [`user:${actor.id}`, BROADCAST];
  switch (actor.role) {
    case 'admin':
      return new Set([
        actor.depotId ? `depot:${actor.depotId}` : ALL_DEPOTS,
        ADMINS,
        ...own,
      ]);
    case 'dispatcher':
      return new Set([
        actor.depotId ? `depot:${actor.depotId}` : ALL_DEPOTS,
        ...own,
      ]);
    case 'store_manager':
      return new Set([
        ...(actor.outletId ? [`outlet:${actor.outletId}`] : []),
        ...own,
      ]);
    case 'loader':
      return new Set([
        ...(actor.depotId ? [`depot:${actor.depotId}:loading`] : []),
        ...own,
      ]);
    case 'driver':
      return new Set([...tripIds.map((id) => `trip:${id}`), ...own]);
    default:
      return new Set(own);
  }
}

const tripIdsOf = (event: DeliveredEvent): string[] => {
  const ids: string[] = [];
  if (event.aggregateType === 'trip' && event.aggregateId)
    ids.push(event.aggregateId);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.tripId === 'string') ids.push(payload.tripId);
  return ids;
};

export function channelsOf(event: DeliveredEvent): string[] {
  if (BROADCAST_TYPES.has(event.type)) return [BROADCAST];
  const out: string[] = [];
  if (event.depotId) {
    out.push(`depot:${event.depotId}`, ALL_DEPOTS);
    if (LOADING_PREFIXES.some((p) => event.type.startsWith(p)))
      out.push(`depot:${event.depotId}:loading`);
  }
  if (event.type !== POSITION_TYPE)
    for (const id of event.outletIds) out.push(`outlet:${id}`);
  for (const id of event.userIds) out.push(`user:${id}`);
  if (event.aggregateType === 'user' && event.aggregateId)
    out.push(`user:${event.aggregateId}`);
  for (const id of tripIdsOf(event)) out.push(`trip:${id}`);
  if (event.type.startsWith('identity.')) out.push(ADMINS);
  return out;
}

export const reaches = (channels: ReadonlySet<string>, event: DeliveredEvent) =>
  channelsOf(event).some((c) => channels.has(c));

/** The SSE frame's data: the DomainEvent JSON the web's useEventStream reads. */
export function toDomainEvent(event: DeliveredEvent) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  return {
    v: typeof payload.v === 'number' ? payload.v : 1,
    type: event.type,
    aggregate: { type: event.aggregateType ?? '', id: event.aggregateId ?? '' },
    routing: {
      depotId: event.depotId,
      outletIds: event.outletIds,
      userIds: event.userIds,
    },
    data: payload,
    occurredAt: new Date(event.occurredAt).toISOString(),
  };
}
