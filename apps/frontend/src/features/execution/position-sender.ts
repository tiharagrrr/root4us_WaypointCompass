import { telematicsPings } from '@compass/api-client'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { serverNow } from '@/lib/server-clock'
import { db, type CompassDb, type PingRow } from '@/offline/db'

/** One fix queued every this often while a trip runs (the screens' own throttle). */
export const QUEUE_EVERY_MS = 5_000
/** Sent as soon as this many are waiting, or every 30 seconds, whichever comes first. */
export const FLUSH_AT = 20
export const FLUSH_EVERY_MS = 30_000
/** The server takes at most 200 per batch. */
const BATCH = 200

/** Adds a fix to the phone's queue; the network is not involved. */
export async function queuePing(row: PingRow, database: CompassDb = db): Promise<number> {
  await database.pings.add(row)
  return database.pings.count()
}

/**
 * Sends what is queued, oldest first. A batch the server answered is done, whatever it accepted:
 * duplicates are already stored and rejected fixes never will be. A failed request keeps the
 * queue for the next try, so a phone without signal loses nothing.
 */
export async function flushPings(database: CompassDb = db, send = telematicsPings): Promise<number> {
  let sent = 0
  for (;;) {
    const batch = await database.pings.orderBy('seq').limit(BATCH).toArray()
    if (!batch.length) return sent
    try {
      await send({
        pings: batch.map((p) => ({
          tripId: p.tripId,
          lat: p.lat,
          lng: p.lng,
          accuracyM: p.accuracyM,
          speedKmh: p.speedKmh,
          heading: p.heading,
          recordedAt: p.recordedAt,
        })),
      })
    } catch {
      return sent
    }
    await database.pings.bulkDelete(batch.map((p) => p.seq!))
    sent += batch.length
  }
}

/**
 * While the phone's trip is IN_PROGRESS, watch the GPS, queue a fix every 5 seconds and send them
 * in batches (ROO-37). Off the moment the trip ends or the app closes; nothing is tracked outside a
 * running trip (specs/execution/spec.md, Privacy).
 */
export function useTripTracking(database: CompassDb = db): void {
  const running = useLiveQuery(
    async () => (await database.trips.where('status').equals('IN_PROGRESS').first()) ?? null,
    [database],
    null,
  )
  const tripId = running?.id ?? null

  useEffect(() => {
    if (!tripId || typeof navigator === 'undefined' || !navigator.geolocation) return
    let lastQueued = 0
    const flush = () => void flushPings(database)
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now()
        if (now - lastQueued < QUEUE_EVERY_MS) return
        lastQueued = now
        const { latitude, longitude, accuracy, speed, heading } = position.coords
        void queuePing(
          {
            tripId,
            lat: latitude,
            lng: longitude,
            accuracyM: Number.isFinite(accuracy) ? accuracy : null,
            speedKmh: speed != null && Number.isFinite(speed) ? speed * 3.6 : null,
            heading: heading != null && Number.isFinite(heading) ? heading : null,
            recordedAt: serverNow().toISOString(),
          },
          database,
        ).then((waiting) => {
          if (waiting >= FLUSH_AT) flush()
        })
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: QUEUE_EVERY_MS },
    )
    const timer = setInterval(flush, FLUSH_EVERY_MS)
    window.addEventListener('online', flush)
    return () => {
      navigator.geolocation.clearWatch(watch)
      clearInterval(timer)
      window.removeEventListener('online', flush)
      flush()
    }
  }, [tripId, database])
}
