// Figma: D1 Today's trip · 185:19938 — the download behind it, and D2 Download failed · 185:20021
import { tripsBundle, type OfflineBundleDto } from '@compass/api-client'
import {
  db,
  enqueue,
  META_KEYS,
  type CachedStop,
  type CachedStopLine,
  type CachedTrip,
  type CompassDb,
} from '@/offline'

/**
 * The offline bundle, written into Dexie. This is the only place the driver app reads the network
 * for trip data: D2 to D9 read the tables this writes, so once the bundle is down the phone needs
 * no signal at all (specs/execution/spec.md, AC-EXE-04).
 *
 * Writing it is deliberately all-or-nothing. A half-written bundle is worse than none — a driver
 * would see stops with no lines, or yesterday's stops beside today's — so the trip, its stops and
 * their lines go in one transaction, and the stale rows of the same trip go out in the same one.
 */
export interface SaveBundleResult {
  tripId: string
  /** The trip version the bundle carries; `POST /trips/{id}/downloaded` records it. */
  version: number
  hash: string
  stops: number
}

/**
 * The frames name a trip by its vehicle and its run of the day ("REF-07 · Trip 1" on D1). The
 * device keeps one reference field, so it holds exactly that string; `vehicleCode` keeps the bare
 * code for anything that needs it on its own.
 */
export const tripRefOf = (vehicleCode: string, tripNo: number | null): string =>
  tripNo === null ? vehicleCode : `${vehicleCode} · Trip ${tripNo}`

export const toCachedTrip = (bundle: OfflineBundleDto): CachedTrip => ({
  id: bundle.trip.id,
  tripRef: tripRefOf(bundle.trip.vehicle.code, bundle.trip.tripNo),
  status: bundle.trip.status,
  vehicleCode: bundle.trip.vehicle.code,
  depotId: bundle.trip.depotId,
  planDate: bundle.trip.date,
  // Empty when planning has not set a departure yet; D1 shows a dash rather than a wrong time.
  departsAt: bundle.trip.plannedDepartAt ?? '',
  stopCount: bundle.stops.length,
  tempClass: bundle.trip.tempClass,
  bundleVersion: bundle.version,
  version: bundle.version,
})

export const toCachedStops = (bundle: OfflineBundleDto): CachedStop[] =>
  bundle.stops.map((stop) => ({
    id: stop.id,
    tripId: bundle.trip.id,
    // An unsequenced stop sorts last rather than first: `sortBy('sequence')` is what D1 and D3 walk.
    sequence: stop.seq ?? Number.MAX_SAFE_INTEGER,
    status: stop.status,
    outletId: stop.outlet.id,
    outletName: stop.outlet.name,
    // The bundle carries the district on the trip, not the stop: every stop of a trip is in the
    // trip's district (specs/planning/spec.md), so this is the district the frames print.
    district: bundle.trip.districtId,
    windowStart: stop.window.open,
    windowEnd: stop.window.close,
    lat: stop.outlet.lat,
    lng: stop.outlet.lng,
    accessNote: stop.outlet.accessNotes,
    contactName: stop.outlet.contactName,
    contactPhone: stop.outlet.contactPhone,
    // The bundle versions itself as a whole and carries no per-stop version, so this is the version
    // the device saw: what a stop event sends as `baseVersion` for /sync to judge staleness against.
    version: bundle.version,
  }))

export const toCachedStopLines = (bundle: OfflineBundleDto): CachedStopLine[] =>
  bundle.stops.flatMap((stop) =>
    stop.order.lines.map((line) => ({
      id: line.id,
      stopId: stop.id,
      orderLineId: line.id,
      itemName: line.name,
      qtyOrdered: line.qty,
      uom: line.packLabel,
    })),
  )

/**
 * Replace this trip's copy of the day. Stops and lines the revision dropped are deleted, so a
 * re-download after a re-sequence or a cancelled stop never leaves a ghost on the list.
 */
export async function saveBundle(
  bundle: OfflineBundleDto,
  database: CompassDb = db,
  savedAt: Date = new Date(),
): Promise<SaveBundleResult> {
  const trip = toCachedTrip(bundle)
  const stops = toCachedStops(bundle)
  const lines = toCachedStopLines(bundle)

  await database.transaction(
    'rw',
    [database.trips, database.stops, database.stopLines, database.meta],
    async () => {
      const stale = await database.stops.where('tripId').equals(trip.id).primaryKeys()
      for (const stopId of stale) {
        await database.stopLines.where('stopId').equals(stopId).delete()
      }
      await database.stops.bulkDelete(stale)

      await database.trips.put(trip)
      await database.stops.bulkPut(stops)
      await database.stopLines.bulkPut(lines)
      // D2 shows this when the next download fails: what the phone already holds, and from when.
      await database.meta.put({ key: META_KEYS.lastBundleAt, value: savedAt.toISOString() })
    },
  )

  return { tripId: trip.id, version: bundle.version, hash: bundle.hash, stops: stops.length }
}

export interface DownloadBundleDeps {
  database?: CompassDb
  /** Injected in tests; in the app it is the generated fetcher for GET /trips/{id}/offline-bundle. */
  fetchBundle?: (tripId: string) => Promise<{ data: OfflineBundleDto }>
  now?: () => Date
}

/**
 * Download the trip and record that this phone holds it. The write is `TRIP_DOWNLOADED` through the
 * outbox, never `POST /trips/{id}/downloaded` from here (architecture rule 10): the depot's Wi-Fi
 * drops often enough that the download itself has to survive a lost connection, and the queued
 * event carries the bundle version the phone actually saved.
 *
 * It throws on a failed fetch, and writes nothing: D1 catches that and shows D2, which keeps the
 * bundle already on the phone (AC-EXE-05).
 */
export async function downloadBundle(
  tripId: string,
  deps: DownloadBundleDeps = {},
): Promise<SaveBundleResult> {
  const { database = db, fetchBundle = (id: string) => tripsBundle(id), now = () => new Date() } = deps
  const response = await fetchBundle(tripId)
  const saved = await saveBundle(response.data, database, now())
  await enqueue(
    {
      kind: 'driver',
      type: 'TRIP_DOWNLOADED',
      tripId: saved.tripId,
      baseVersion: saved.version,
    },
    database,
  )
  return saved
}

/** When this phone last saved a bundle, for D2's "Last saved 03:05". */
export async function lastBundleAt(database: CompassDb = db): Promise<Date | null> {
  const row = await database.meta.get(META_KEYS.lastBundleAt)
  return typeof row?.value === 'string' ? new Date(row.value) : null
}
