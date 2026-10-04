import type { TripSummaryDto } from '@compass/api-client'
import { formatColombo } from '@/lib/format-colombo'

const time = (instant: string): string => formatColombo(instant, 'HH:mm')

/** "REF-07 · Trip 2", as the cards and D11's title name a trip. */
export const tripTitle = (trip: Pick<TripSummaryDto, 'vehicle' | 'tripNo'>): string =>
  trip.tripNo === null ? trip.vehicle.code : `${trip.vehicle.code} · Trip ${trip.tripNo}`

/** "05:45–10:12" for a finished round, "Started 05:45" on the road, "Departs 11:30" before it. */
export const tripTimes = (trip: TripSummaryDto, t: (key: string, options?: Record<string, unknown>) => string): string => {
  if (trip.startedAt && trip.completedAt) return `${time(trip.startedAt)}–${time(trip.completedAt)}`
  if (trip.startedAt) return t('driver.startedTime', { time: time(trip.startedAt) })
  return trip.plannedDepartAt ? t('driver.departsTime', { time: time(trip.plannedDepartAt) }) : '—'
}
