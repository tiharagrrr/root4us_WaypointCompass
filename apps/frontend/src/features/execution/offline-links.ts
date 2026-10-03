import { stopMachine, tripMachine } from '@waypoint/shared'
import type { CachedStop, CachedTrip } from '@/offline'
import type { Link } from '@/lib/links'

/**
 * The actions a cached trip or stop offers when the phone has no signal.
 *
 * The server builds a driver's action links from exactly two things: the state machine and whether
 * the caller holds `stop:record` on that trip (apps/backend/src/modules/execution/policies). In a
 * dead zone the second is not in doubt — the trip is in this phone's bundle, so it is this driver's
 * to record — and the first is `@waypoint/shared`, the same module the server reads. So the phone
 * rebuilds the same map rather than inventing one, and the screens still render every button
 * through `<Action>`: a status that offers nothing shows nothing (architecture rule 9).
 *
 * The hrefs are the online shortcuts the event would take if it went straight out. Driver screens
 * never call them — the write goes through the outbox (rule 10) — but they keep the link honest and
 * make the queued event's destination visible in the markup.
 */
const link = (offered: boolean, href: string, title: string): Link | undefined =>
  offered ? { href, method: 'POST', title } : undefined

export interface CachedTripLinks {
  start?: Link
  complete?: Link
  cantRun?: Link
}

export const cachedTripLinks = (trip: CachedTrip | undefined, openStops = 0): CachedTripLinks => {
  if (!trip) return {}
  const base = `/api/v1/trips/${trip.id}`
  return {
    start: link(tripMachine.can(trip.status, 'START'), `${base}/start`, 'Start trip'),
    // The trip ends only once every stop has a result (AC-EXE-15).
    complete: link(
      tripMachine.can(trip.status, 'COMPLETE') && openStops === 0,
      `${base}/complete`,
      'Finish trip',
    ),
    // The server also checks that no reason is recorded yet; on the phone that is the same check,
    // because the queued CANT_RUN moves the cached trip out of these two statuses at once.
    cantRun: link(
      trip.status === 'RELEASED' || trip.status === 'IN_PROGRESS',
      `${base}/cant-run`,
      "Can't run this trip",
    ),
  }
}

export interface CachedStopLinks {
  arrive?: Link
  complete?: Link
  fail?: Link
}

/**
 * A stop's actions. They exist only while its trip is running, which is what keeps D3's "I'm here"
 * off a trip the driver has not started yet.
 */
export const cachedStopLinks = (
  stop: CachedStop | undefined,
  tripStatus: CachedTrip['status'] | undefined,
): CachedStopLinks => {
  if (!stop || tripStatus !== 'IN_PROGRESS') return {}
  const base = `/api/v1/stops/${stop.id}`
  return {
    arrive: link(stopMachine.can(stop.status, 'ARRIVE'), `${base}/arrive`, 'I am here'),
    complete: link(stopMachine.can(stop.status, 'DELIVER'), `${base}/complete`, 'Delivered'),
    fail: link(stopMachine.can(stop.status, 'FAIL'), `${base}/fail`, 'Could not deliver'),
  }
}
