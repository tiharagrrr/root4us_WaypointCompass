import { usePlansTracking, type TrackingStopDto, type TrackingTripDto } from '@compass/api-client'
import { formatColombo } from '@/lib/format-colombo'
import type { StatusTone } from '@/ui/status-chip'
import { clock } from './plan-copy'

/** How often the live day refreshes while the server's event stream is not built (ROO-25). */
const REFRESH_MS = 30_000

/**
 * One depot's day on the road (01, 19, 19a), from GET /depots/{id}/tracking. It refreshes every
 * 30 seconds; the realtime map also invalidates it as trips and stops change.
 */
export function useLiveDay(depotId: string, date?: string) {
  return usePlansTracking(depotId, date ? { date } : undefined, { query: { refetchInterval: REFRESH_MS } })
}

/** 19's and 01's trip chips. */
export const TRIP_STANDING: Record<string, { label: string; tone: StatusTone }> = {
  LATE_RISK: { label: 'Late risk', tone: 'danger' },
  ON_TIME: { label: 'On time', tone: 'neutral' },
  LOADING: { label: 'Loading', tone: 'info' },
  PLANNED: { label: 'Planned', tone: 'muted' },
  COMPLETE: { label: 'Complete', tone: 'neutral' },
}

/** 19a's stop chips. */
export const STOP_STANDING: Record<string, { label: string; tone: StatusTone }> = {
  DELIVERED: { label: 'Delivered', tone: 'success' },
  PARTIAL: { label: 'Partial', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  NEXT: { label: 'Next', tone: 'info' },
  AT_RISK: { label: 'At risk', tone: 'warning' },
  LATE: { label: 'Late', tone: 'danger' },
  PLANNED: { label: 'Planned', tone: 'muted' },
}

/** "07:42": the actual arrival when there is one, then the projection, then the plan. */
export function stopTime(s: TrackingStopDto): string {
  const at = s.arrivedAt ?? s.etaAt ?? s.plannedArrivalAt
  return at ? formatColombo(at, 'HH:mm') : '—'
}

/** "25 min spare", "+14 min", "on time": the second line of a 19a stop. */
export function stopSpare(s: TrackingStopDto): string {
  if (s.standing === 'DELIVERED' || s.standing === 'PARTIAL') return 'on time'
  if (s.spareMin === null) return ''
  return s.spareMin < 0 ? `+${-s.spareMin} min` : `${s.spareMin} min spare`
}

/** "Next ETA 07:42 · window 07:00–08:00", or how a trip not yet out reads. */
export function nextLine(t: TrackingTripDto, depotName: string): string {
  if (t.status === 'COMPLETED') return `All ${t.stopsTotal} stops done`
  if (t.status !== 'IN_PROGRESS' && t.status !== 'RELEASED')
    return t.plannedDepartAt ? `Departs ${formatColombo(t.plannedDepartAt, 'HH:mm')} · ${depotName}` : `Leaves from ${depotName}`
  if (!t.nextEtaAt) return 'Heading back'
  const window =
    t.nextWindowOpenMin !== null && t.nextWindowCloseMin !== null ? ` · window ${clock(t.nextWindowOpenMin)}–${clock(t.nextWindowCloseMin)}` : ''
  return `Next ETA ${formatColombo(t.nextEtaAt, 'HH:mm')}${window}`
}
