import { z } from 'zod';
import {
  CANT_RUN_REASONS,
  DELIVERY_OUTCOMES,
  LOAD_FLAG_REASONS,
  STOP_EVENT_TYPES,
} from '../domain';

/**
 * The offline outbox contract for POST /api/v1/sync (specs/sync/spec.md): what a driver's phone or
 * a dock tablet queued, flattened one event per row. Every event carries a client-generated UUID so
 * a replay after reconnect is idempotent, and the device time so a late event is flagged rather than
 * reordered. The server tells a driver event from a loader event by its `type`.
 */

/** A batch holds at most this many events; more is 413 PAYLOAD_TOO_LARGE (AC-SYN-05). */
export const SYNC_MAX_EVENTS = 100;

export const LOADER_EVENT_TYPES = [
  'LOAD_LINE_CHECKED',
  'LOAD_CHECK_UNDONE',
  'LOAD_FLAG_RAISED',
  'LOAD_FLAG_UNDONE',
  'LOAD_RECHECKED',
] as const;
export type LoaderEventType = (typeof LOADER_EVENT_TYPES)[number];

export const LINE_CONDITIONS = ['ok', 'damaged', 'refused'] as const;

/** What every queued event carries, whoever queued it. */
const queuedBase = {
  clientUuid: z.uuid(),
  tripId: z.uuid(),
  /** The device clock aligned to the server's, ISO 8601 with an offset. */
  occurredAt: z.iso.datetime({ offset: true }),
  /** The raw device clock, kept for the record. */
  deviceTime: z.string().max(40).optional(),
  /** Creation order on the device; a batch applies in this order. */
  deviceSeq: z.number().int().nonnegative().optional(),
  /** The trip or stop version the device saw; a stale one is a conflict. */
  baseVersion: z.number().int().nonnegative().optional(),
  note: z.string().max(2000).optional(),
  /** Attachments by their own clientUuid: the id does not exist yet offline. */
  attachmentUuids: z.array(z.uuid()).max(20).optional(),
};

export const syncLineSchema = z.object({
  orderLineId: z.uuid(),
  qtyDelivered: z.number().int().nonnegative(),
  condition: z.enum(LINE_CONDITIONS),
  note: z.string().max(2000).optional(),
});
export type SyncLine = z.infer<typeof syncLineSchema>;

/** A driver's event: a stop-level one names its stop; the trip-level ones do not. */
export const syncDriverEventSchema = z.object({
  ...queuedBase,
  type: z.enum(STOP_EVENT_TYPES),
  stopId: z.uuid().optional(),
  outcome: z.enum(DELIVERY_OUTCOMES).optional(),
  receiverName: z.string().max(200).optional(),
  reasonCode: z.enum(CANT_RUN_REASONS).optional(),
  lines: z.array(syncLineSchema).max(200).optional(),
  reeferTempC: z.number().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type SyncDriverEvent = z.infer<typeof syncDriverEventSchema>;

/** A loader's event from the shared dock tablet. */
export const syncLoaderEventSchema = z.object({
  ...queuedBase,
  type: z.enum(LOADER_EVENT_TYPES),
  loadLineId: z.uuid().optional(),
  loadFlagId: z.uuid().optional(),
  /** Who looked in the crate: the tablet is shared, so the account alone does not say. */
  checkedByName: z.string().max(120).optional(),
  qtyLoaded: z.number().int().nonnegative().optional(),
  reason: z.enum(LOAD_FLAG_REASONS).optional(),
  qtyAffected: z.number().int().nonnegative().optional(),
  photoClientUuid: z.uuid().optional(),
});
export type SyncLoaderEvent = z.infer<typeof syncLoaderEventSchema>;

export const syncEventSchema = z.union([syncDriverEventSchema, syncLoaderEventSchema]);
export type SyncEvent = z.infer<typeof syncEventSchema>;

export const isLoaderEventType = (type: unknown): type is LoaderEventType =>
  typeof type === 'string' && (LOADER_EVENT_TYPES as readonly string[]).includes(type);

/**
 * The envelope. Events are checked one by one by the server, so one bad event is one rejected
 * result and never a 400 for the batch (AC-SYN-03); only the envelope itself is validated here.
 */
export const syncBatchSchema = z.object({
  deviceId: z.string().min(1).max(100),
  events: z.array(z.unknown()),
});
export type SyncBatch = z.infer<typeof syncBatchSchema>;

export const SYNC_RESULT_STATUSES = ['applied', 'duplicate', 'conflict', 'rejected'] as const;
export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];

/** One event's verdict, keyed by the clientUuid the device made. */
export interface SyncResult {
  clientUuid: string;
  status: SyncResultStatus;
  /** Why, for `conflict` and `rejected`: a problem code such as VALIDATION_FAILED. */
  code?: string;
  /** What the person should do about it. */
  message?: string;
  /** The row the event touched, so the device can reconcile its cache. */
  id?: string;
}
