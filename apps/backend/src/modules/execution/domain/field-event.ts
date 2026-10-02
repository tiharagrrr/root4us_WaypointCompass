import type {
  CantRunReason,
  DeliveryOutcome,
  StopEventType,
} from '@waypoint/shared';
import { LATE_SYNC_MINUTES } from '../execution.constants';

/**
 * One field event, however it reached the server: an online shortcut
 * (`POST /stops/{id}/arrive`) or a queued one replayed through `POST /sync`.
 * `StopEventService.apply()` takes this and nothing else, so the two paths
 * cannot drift (specs/execution/spec.md, Services; specs/sync/spec.md).
 *
 * `packages/shared`'s `stopEventSchema` is the thinner wire contract the PWA
 * outbox was scaffolded against: it requires a stopId (trip-level events have
 * none) and carries no deviceSeq, baseVersion, lines or attachments. ROO-44
 * owns that schema and widens it when it builds `/sync`; this type is what
 * the server works in meanwhile.
 */
export interface FieldEvent {
  /** Made on the phone; the unique index on stop_events makes replays safe. */
  clientUuid: string;
  type: StopEventType;
  /**
   * The trip the event belongs to. A stop-level event may leave it out: the
   * stop knows its own trip, and `/stops/{id}/arrive` has no trip in its
   * path. When both are given they must agree, or the stop is not this
   * trip's to record on (AC-EXE-02).
   */
  tripId?: string;
  /** Null for the trip-level events: download, start, complete, can't run. */
  stopId?: string | null;
  /** The device clock, already aligned to the server's (specs/sync/spec.md). */
  occurredAt: Date;
  /** Creation order on the device, so a batch applies in the driver's order. */
  deviceSeq?: number | null;
  deviceId?: string | null;
  /**
   * The stop or trip version the device saw. A write against a stale version
   * is a conflict for `/sync` to resolve; online, it means the screen is old.
   */
  baseVersion?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** DELIVERED, PARTIAL and FAILED; the stop's outcome column. */
  outcome?: DeliveryOutcome | null;
  receiverName?: string | null;
  note?: string | null;
  /** CANT_RUN's reason (D8). */
  reasonCode?: CantRunReason | null;
  lines?: readonly FieldEventLine[] | null;
  /** Signature and photo attachments by their own clientUuid, not by id. */
  attachmentUuids?: readonly string[] | null;
  /** TRIP_STARTED on a chilled or frozen trip. */
  reeferTempC?: number | null;
  /** TRIP_DOWNLOADED: which bundle the phone holds. */
  bundleVersion?: number | null;
  bundleHash?: string | null;
}

/** One order line as the phone recorded it against the stop. */
export interface FieldEventLine {
  orderLineId: string;
  qtyDelivered: number;
  condition: LineCondition;
  note?: string | null;
}

export const LINE_CONDITIONS = ['ok', 'damaged', 'refused'] as const;
export type LineCondition = (typeof LINE_CONDITIONS)[number];

/**
 * True when the event reached the server more than five minutes after it
 * happened: 19a shows those as "Synced late" and `stop_events.lateSync`
 * keeps the fact (specs/execution/spec.md, Services).
 */
export function isLateSync(occurredAt: Date, receivedAt: Date): boolean {
  return (
    receivedAt.getTime() - occurredAt.getTime() > LATE_SYNC_MINUTES * 60_000
  );
}

/** The trip-level events, which carry no stopId. */
const TRIP_LEVEL = new Set<StopEventType>([
  'TRIP_DOWNLOADED',
  'TRIP_STARTED',
  'TRIP_COMPLETED',
  'CANT_RUN',
]);

export const isTripLevel = (type: StopEventType): boolean =>
  TRIP_LEVEL.has(type);

/**
 * What goes in `stop_events.payload`: everything the event said that is not
 * already a column, so the row stays a faithful record of what the phone
 * sent even after the projection moves on. Keys with nothing in them are
 * left out, so a replay hashes the same way.
 */
export function payloadOf(event: FieldEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null) payload[key] = value;
  };
  put('outcome', event.outcome);
  put('receiverName', event.receiverName);
  put('note', event.note);
  put('reasonCode', event.reasonCode);
  put('reeferTempC', event.reeferTempC);
  put('bundleVersion', event.bundleVersion);
  put('bundleHash', event.bundleHash);
  put('baseVersion', event.baseVersion);
  if (event.lines?.length) payload.lines = event.lines;
  if (event.attachmentUuids?.length)
    payload.attachmentUuids = event.attachmentUuids;
  return payload;
}

/**
 * The fields every field-event request carries, whatever it records, turned
 * into what `StopEventService.apply` takes. `occurredAt` becomes a Date here
 * and nowhere else, so a controller never parses a time of its own.
 */
export function fieldsOf(dto: {
  clientUuid: string;
  occurredAt: string;
  deviceSeq?: number;
  deviceId?: string;
  baseVersion?: number;
  lat?: number;
  lng?: number;
}): Pick<
  FieldEvent,
  | 'clientUuid'
  | 'occurredAt'
  | 'deviceSeq'
  | 'deviceId'
  | 'baseVersion'
  | 'lat'
  | 'lng'
> {
  return {
    clientUuid: dto.clientUuid,
    occurredAt: new Date(dto.occurredAt),
    deviceSeq: dto.deviceSeq ?? null,
    deviceId: dto.deviceId ?? null,
    baseVersion: dto.baseVersion ?? null,
    lat: dto.lat ?? null,
    lng: dto.lng ?? null,
  };
}
