import Dexie, { type EntityTable } from 'dexie'
import type {
  LoadFlagStatus,
  LoadLineStatus,
  StopStatus,
  TripStatus,
} from '@waypoint/shared'
import type { QueuedEvent } from './events'

/**
 * The device's own copy of the day. Driver and loader screens read from here and never from a
 * generated query hook, so every screen after the bundle download renders the same with or without
 * signal (architecture rule 10; specs/sync/spec.md).
 *
 * Dexie is the only cache. The service worker must not cache API responses: two caches with
 * different ideas of the truth is how a driver ends up delivering to yesterday's stop.
 */

export interface CachedTrip {
  id: string
  tripRef: string
  status: TripStatus
  vehicleCode: string
  depotId: string
  planDate: string
  departsAt: string
  stopCount: number
  tempClass: string | null
  /** The bundle this came from, so D2 can tell the driver what it already holds. */
  bundleVersion: number
  version: number
}

export interface CachedStop {
  id: string
  tripId: string
  /** Delivery order. L2 walks it backwards; D3 walks it forwards. */
  sequence: number
  status: StopStatus
  outletId: string
  outletName: string
  district: string
  windowStart: string | null
  windowEnd: string | null
  lat: number | null
  lng: number | null
  accessNote: string | null
  contactName: string | null
  contactPhone: string | null
  version: number
}

export interface CachedStopLine {
  id: string
  stopId: string
  orderLineId: string
  itemName: string
  qtyOrdered: number
  uom: string
}

export interface CachedLoadLine {
  id: string
  tripId: string
  stopId: string
  /** Reverse delivery order: the last stop is loaded first (AC-LOD-01). */
  loadSequence: number
  itemName: string
  qtyPlanned: number
  qtyLoaded: number | null
  status: LoadLineStatus
  tempClass: string | null
  fragile: boolean
  checkedByName: string | null
  version: number
}

export interface CachedLoadFlag {
  id: string
  tripId: string
  loadLineId: string
  status: LoadFlagStatus
  reason: string
  qtyAffected: number
  note: string | null
  decision: string | null
  decisionNote: string | null
  raisedByName: string | null
  version: number
}

/** One queued write, with everything needed to replay it in the order it was tapped. */
export interface OutboxRow {
  /** Autoincremented, so `deviceSeq` is the tap order and never collides. */
  deviceSeq?: number
  /** Made on the device (uuidv7). The unique index on the server table makes replays safe. */
  clientUuid: string
  event: QueuedEvent
  status: 'pending' | 'sending' | 'conflict' | 'rejected'
  /** Server-aligned device time: when the loader or driver actually tapped. */
  occurredAt: string
  /** The raw device clock, kept even when it disagrees with the server's. */
  deviceTime: string
  attempts: number
  /** When the sync engine may next try this row. */
  nextAttemptAt: string | null
  code?: string
  message?: string
}

/** A photo or signature, queued as a Blob and uploaded on its own retry. */
export interface AttachmentRow {
  clientUuid: string
  blob: Blob
  contentType: string
  kind: 'photo' | 'signature'
  status: 'pending' | 'uploading' | 'uploaded'
  attempts: number
  /** Set once the upload completes, so the event can stop referring to the Blob. */
  attachmentId: string | null
}

/** A GPS fix waiting to go to POST /telematics/pings (ROO-37), oldest first. */
export interface PingRow {
  seq?: number
  tripId: string
  lat: number
  lng: number
  accuracyM: number | null
  speedKmh: number | null
  heading: number | null
  /** Server-aligned time of the fix, like every other queued record. */
  recordedAt: string
}

/** Single-row bookkeeping, keyed by name. */
export interface MetaRow {
  key: string
  value: string | number | null
}

export class CompassDb extends Dexie {
  trips!: EntityTable<CachedTrip, 'id'>
  stops!: EntityTable<CachedStop, 'id'>
  stopLines!: EntityTable<CachedStopLine, 'id'>
  loadLines!: EntityTable<CachedLoadLine, 'id'>
  loadFlags!: EntityTable<CachedLoadFlag, 'id'>
  outbox!: EntityTable<OutboxRow, 'deviceSeq'>
  attachments!: EntityTable<AttachmentRow, 'clientUuid'>
  meta!: EntityTable<MetaRow, 'key'>
  pings!: EntityTable<PingRow, 'seq'>

  constructor(name = 'compass') {
    super(name)
    this.version(1).stores({
      trips: 'id, status, planDate',
      stops: 'id, tripId, [tripId+sequence], status',
      stopLines: 'id, stopId',
      loadLines: 'id, tripId, [tripId+loadSequence], status',
      loadFlags: 'id, tripId, loadLineId, status',
      outbox: '++deviceSeq, clientUuid, status',
      attachments: 'clientUuid, status',
      meta: 'key',
    })
    // Version 2 only adds the GPS queue; every version-1 table stays as it is.
    this.version(2).stores({ pings: '++seq, tripId' })
  }
}

export const db = new CompassDb()

export const META_KEYS = {
  deviceId: 'deviceId',
  lastSyncAt: 'lastSyncAt',
  lastBundleAt: 'lastBundleAt',
  /** 'true' while a 401 has paused sync; the banner reads it to say "Sign in to send". */
  syncPaused: 'syncPaused',
  changeCursor: 'changeCursor',
  checkedByName: 'checkedByName',
} as const
