import type { TrackingDayDto, TrackingStopDto, TrackingTripDto } from '@compass/api-client'

/** A live position from the stream, keyed by trip (vehicle.position carries the tripId). */
export interface LivePosition {
  lat: number
  lng: number
  heading: number | null
  recordedAt: string
}

export type LngLat = [lng: number, lat: number]

/** How a marker reads, in the legend's words. */
export type Tone = 'vehicle' | 'no-signal' | 'delivered' | 'upcoming' | 'at-risk' | 'late'

export interface VehicleMark {
  tripId: string
  label: string
  at: LngLat
  tone: Extract<Tone, 'vehicle' | 'no-signal'>
  selected: boolean
}

export interface StopMark {
  stopId: string
  seq: number | null
  at: LngLat
  tone: Exclude<Tone, 'vehicle' | 'no-signal'>
  /** "Ja-Ela · 25 min spare", "Ragama · +22 min"; only on the selected trip. */
  label: string | null
}

export interface MapModel {
  depot: { at: LngLat; label: string } | null
  vehicles: VehicleMark[]
  stops: StopMark[]
  /** The selected trip: driven (depot to the vehicle, through finished stops) and still to come. */
  driven: LngLat[]
  ahead: LngLat[]
  /** Everything worth framing; null when nothing has coordinates. */
  bounds: [LngLat, LngLat] | null
}

const ll = (p: { lat: number; lng: number }): LngLat => [p.lng, p.lat]
const DONE = new Set(['DELIVERED', 'PARTIAL', 'FAILED'])

/** "Fresh Ja-Ela" reads as "Ja-Ela" on the map, where the brand is noise. */
const placeOf = (outletName: string) => outletName.replace(/^(Fresh|Style|Tech) /, '')

function stopTone(stop: TrackingStopDto): StopMark['tone'] {
  if (DONE.has(stop.status) || stop.standing === 'DELIVERED' || stop.standing === 'PARTIAL') return 'delivered'
  if (stop.standing === 'LATE') return 'late'
  if (stop.standing === 'AT_RISK') return 'at-risk'
  return 'upcoming'
}

function stopLabel(stop: TrackingStopDto): string | null {
  if (stopTone(stop) === 'delivered' || stop.spareMin === null) return null
  const place = placeOf(stop.outletName)
  return stop.spareMin < 0 ? `${place} · +${-stop.spareMin} min` : `${place} · ${stop.spareMin} min spare`
}

/**
 * What 19 and 19a draw: the depot, every trip on the road where it is now (the stream's latest
 * position, else the tracking read's), and for the selected trip its stops in order, the legs it
 * has driven and the legs still to come. Pure, so the map's content is tested without WebGL.
 */
export function mapModel(
  day: Pick<TrackingDayDto, 'depot' | 'trips'>,
  depotName: string,
  live: ReadonlyMap<string, LivePosition>,
  selectedTripId: string | null,
): MapModel {
  const points: LngLat[] = []
  const depot = day.depot ? { at: ll(day.depot), label: `${depotName} depot` } : null
  if (depot) points.push(depot.at)

  const onRoad = day.trips.filter((t) => t.status === 'IN_PROGRESS' || t.tripId === selectedTripId)
  const vehicles: VehicleMark[] = []
  for (const trip of onRoad) {
    const now = live.get(trip.tripId) ?? trip.position
    if (!now) continue
    const at = ll(now)
    points.push(at)
    vehicles.push({
      tripId: trip.tripId,
      label: `${trip.vehicleCode} · ${trip.delivered}/${trip.stopsTotal}`,
      at,
      tone: trip.noSignalSince && !live.has(trip.tripId) ? 'no-signal' : 'vehicle',
      selected: trip.tripId === selectedTripId,
    })
  }

  const selected: TrackingTripDto | undefined = day.trips.find((t) => t.tripId === selectedTripId)
  const stops: StopMark[] = []
  const driven: LngLat[] = []
  const ahead: LngLat[] = []
  if (selected) {
    const ordered = [...selected.stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    for (const stop of ordered) {
      if (!stop.at) continue
      const at = ll(stop.at)
      points.push(at)
      stops.push({ stopId: stop.stopId, seq: stop.seq, at, tone: stopTone(stop), label: stopLabel(stop) })
    }
    const vehicle = vehicles.find((v) => v.tripId === selected.tripId)?.at
    const finished = stops.filter((s) => s.tone === 'delivered').map((s) => s.at)
    const toCome = stops.filter((s) => s.tone !== 'delivered').map((s) => s.at)
    if (depot) driven.push(depot.at)
    driven.push(...finished)
    if (vehicle) driven.push(vehicle)
    const from = vehicle ?? finished.at(-1) ?? depot?.at
    if (from && toCome.length) ahead.push(from, ...toCome)
  }

  return { depot, vehicles, stops, driven: driven.length > 1 ? driven : [], ahead, bounds: boundsOf(points) }
}

function boundsOf(points: readonly LngLat[]): [LngLat, LngLat] | null {
  if (!points.length) return null
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}
