import type { CompassDb } from './db'
import type { QueuedEvent } from './events'

/**
 * Move the device's cache the way the server will, so the screen shows the tap at once whether or
 * not there is signal. Pure in spirit: it only touches the Dexie tables it is given, inside the
 * caller's transaction, and never calls the network or the clock.
 *
 * A case that cannot be applied locally does nothing and lets the server be the judge; it must
 * never throw, or the whole enqueue transaction rolls back and the tap is lost.
 */
export async function applyOptimistic(
  db: CompassDb,
  event: QueuedEvent,
  clientUuid: string,
): Promise<void> {
  if (event.kind === 'loader') return applyLoader(db, event, clientUuid)
  return applyDriver(db, event)
}

async function applyLoader(
  db: CompassDb,
  event: Extract<QueuedEvent, { kind: 'loader' }>,
  clientUuid: string,
): Promise<void> {
  switch (event.type) {
    case 'LOAD_LINE_CHECKED': {
      if (!event.loadLineId) return
      await db.loadLines.update(event.loadLineId, {
        status: 'OK',
        qtyLoaded: event.qtyLoaded ?? null,
        checkedByName: event.checkedByName ?? null,
      })
      return
    }
    case 'LOAD_CHECK_UNDONE': {
      if (!event.loadLineId) return
      await db.loadLines.update(event.loadLineId, {
        status: 'PENDING',
        qtyLoaded: null,
        checkedByName: null,
      })
      return
    }
    case 'LOAD_FLAG_RAISED': {
      if (!event.loadLineId) return
      await db.loadLines.update(event.loadLineId, { status: 'FLAGGED' })
      // The flag's own id is the server's to make; until it syncs the row is keyed by the tap's
      // clientUuid, which is what L3a's Undo looks it up by.
      await db.loadFlags.put({
        id: clientUuid,
        tripId: event.tripId,
        loadLineId: event.loadLineId,
        status: 'OPEN',
        reason: event.reason ?? 'MISSING',
        qtyAffected: event.qtyAffected ?? 0,
        note: event.note ?? null,
        decision: null,
        decisionNote: null,
        raisedByName: event.checkedByName ?? null,
        version: 0,
      })
      return
    }
    case 'LOAD_FLAG_UNDONE': {
      if (!event.loadFlagId) return
      const flag = await db.loadFlags.get(event.loadFlagId)
      await db.loadFlags.delete(event.loadFlagId)
      if (flag) await db.loadLines.update(flag.loadLineId, { status: 'PENDING' })
      return
    }
    case 'LOAD_RECHECKED': {
      if (!event.loadFlagId) return
      const flag = await db.loadFlags.get(event.loadFlagId)
      await db.loadFlags.update(event.loadFlagId, { status: 'RESOLVED' })
      if (flag) {
        await db.loadLines.update(flag.loadLineId, {
          status: 'OK',
          qtyLoaded: event.qtyLoaded ?? null,
          checkedByName: event.checkedByName ?? null,
        })
      }
      return
    }
  }
}

async function applyDriver(
  db: CompassDb,
  event: Extract<QueuedEvent, { kind: 'driver' }>,
): Promise<void> {
  switch (event.type) {
    case 'TRIP_STARTED':
      await db.trips.update(event.tripId, { status: 'IN_PROGRESS' })
      return
    case 'TRIP_COMPLETED':
      await db.trips.update(event.tripId, { status: 'COMPLETED' })
      return
    case 'CANT_RUN':
      // The dispatcher reassigns the trip; the phone shows it as no longer the driver's to run.
      await db.trips.update(event.tripId, { status: 'CANCELLED' })
      return
    case 'ARRIVED':
      if (event.stopId) await db.stops.update(event.stopId, { status: 'ARRIVED' })
      return
    case 'DELIVERED':
      if (event.stopId) await db.stops.update(event.stopId, { status: 'DELIVERED' })
      return
    case 'PARTIAL':
      if (event.stopId) await db.stops.update(event.stopId, { status: 'PARTIAL' })
      return
    case 'FAILED':
      if (event.stopId) await db.stops.update(event.stopId, { status: 'FAILED' })
      return
    case 'ISSUE_REPORTED':
    case 'TRIP_DOWNLOADED':
      // Neither changes what a screen shows: the issue lives on the stop event, and the download
      // is recorded by the bundle writer itself.
      return
  }
}
