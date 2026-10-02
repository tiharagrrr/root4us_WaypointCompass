import type {
  DeliveryOutcome,
  StopEventType,
  StopStatus,
} from '@waypoint/shared';

/** The part of a stop event this projection reads. */
export interface ProjectableEvent {
  type: StopEventType;
  occurredAt: Date;
  outcome?: DeliveryOutcome | null;
  receiverName?: string | null;
  note?: string | null;
  unitsDelivered?: number | null;
  lat?: number | null;
  lng?: number | null;
  supersededAt?: Date | null;
}

/** A stop as its events say it stands. */
export interface ProjectedStop {
  status: StopStatus;
  arrivedAt: Date | null;
  arrivedLat: number | null;
  arrivedLng: number | null;
  completedAt: Date | null;
  outcome: DeliveryOutcome | null;
  receiverName: string | null;
  exceptionNote: string | null;
  unitsDelivered: number | null;
}

const EMPTY: ProjectedStop = {
  status: 'PENDING',
  arrivedAt: null,
  arrivedLat: null,
  arrivedLng: null,
  completedAt: null,
  outcome: null,
  receiverName: null,
  exceptionNote: null,
  unitsDelivered: null,
};

/**
 * A stop's state from its events, oldest first. The stored columns are a
 * cache of exactly this, which is what makes the event log the record and the
 * stop row a projection (specs/execution/spec.md, Model): rebuild a stop from
 * its events and nothing is lost.
 *
 * Superseded events (a sync conflict resolved against them) are skipped, and
 * an outcome already recorded is never overwritten — the append-only rule
 * AC-EXE-13 turns into 409 in the service and into "first one wins" here.
 */
export function projectStop(
  events: readonly ProjectableEvent[],
): ProjectedStop {
  let stop = EMPTY;
  for (const event of events) {
    if (event.supersededAt) continue;
    switch (event.type) {
      case 'ARRIVED':
        if (stop.status !== 'PENDING') break;
        stop = {
          ...stop,
          status: 'ARRIVED',
          arrivedAt: event.occurredAt,
          arrivedLat: event.lat ?? null,
          arrivedLng: event.lng ?? null,
        };
        break;
      case 'DELIVERED':
      case 'PARTIAL':
      case 'FAILED':
        if (stop.status !== 'ARRIVED') break;
        stop = {
          ...stop,
          status: statusOf(event.type),
          completedAt: event.occurredAt,
          outcome: event.outcome ?? null,
          receiverName: event.receiverName ?? null,
          exceptionNote: event.note ?? null,
          unitsDelivered: event.unitsDelivered ?? null,
        };
        break;
      default:
        break; // trip-level events and ISSUE_REPORTED leave the stop alone
    }
  }
  return stop;
}

const statusOf = (type: 'DELIVERED' | 'PARTIAL' | 'FAILED'): StopStatus =>
  type === 'DELIVERED'
    ? 'DELIVERED'
    : type === 'PARTIAL'
      ? 'PARTIAL'
      : 'FAILED';
