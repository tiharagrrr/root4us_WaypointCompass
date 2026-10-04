import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { eventBus, isDomainEvent, type DomainEvent } from './event-bus'

/**
 * Which cached paths an event makes stale. The generated hooks key their queries by URL
 * (`['/api/v1/orders', params]`), so a cache entry matches when its key starts with one of these
 * paths — Step 8's `['orders']` keys predate the orval client.
 *
 * One line per event type in the Step 2 catalogue; add an event here when its module publishes it.
 */
const INVALIDATES: Record<string, (event: DomainEvent) => readonly string[]> = {
  'order.submitted': (e) => ['/api/v1/orders', `/api/v1/depots/${String(e.routing.depotId)}/days`],
  'order.cancelled': () => ['/api/v1/orders'],
  // M1 to M3 and 02's depot day follow a store's edits as they are saved.
  'order.created': (e) => ['/api/v1/orders', `/api/v1/depots/${String(e.routing.depotId)}/days`],
  'order.updated': (e) => [`/api/v1/orders/${e.aggregate.id}`, '/api/v1/depots'],
  'order.lines_changed': (e) => [`/api/v1/orders/${e.aggregate.id}`, '/api/v1/depots'],
  'order.priority_changed': (e) => [`/api/v1/orders/${e.aggregate.id}`, '/api/v1/depots'],
  'order.backordered': () => ['/api/v1/orders', '/api/v1/depots'],
  'order.deleted': () => ['/api/v1/orders', '/api/v1/depots'],
  'order.cutoff_reminder': () => ['/api/v1/orders'],
  'order.cutoff_closed': () => ['/api/v1/orders', '/api/v1/depots'],
  'order_template.created': () => ['/api/v1/order-templates'],
  'order_template.deleted': () => ['/api/v1/order-templates'],
  'receiving_roster.replaced': () => ['/api/v1/outlets'],
  'order.rolled_to_next_run': () => ['/api/v1/orders'],
  'plan.published': (e) => [`/api/v1/plans/${e.aggregate.id}`, '/api/v1/me/trips', '/api/v1/depots'],
  // Another dispatcher's edit or engine run on the same plan (06, 07).
  'plan.edited': (e) => [`/api/v1/plans/${e.aggregate.id}`],
  'plan.engine_run.completed': () => ['/api/v1/plans'],
  'plan.engine_run.failed': () => ['/api/v1/plans'],
  'plan.revised': (e) => [`/api/v1/plans/${e.aggregate.id}`, '/api/v1/me/trips', '/api/v1/depots'],
  'load.flag_raised': (e) => [`/api/v1/trips/${String(e.data.tripId)}/load-list`, '/api/v1/depots'],
  // The dock's list is rebuilt by a plan revision; the banner on L2 comes off the same event.
  'load.list_updated': (e) => [`/api/v1/trips/${String(e.data.tripId)}/load-list`, '/api/v1/depots'],
  'load.line_checked': (e) => [`/api/v1/trips/${String(e.data.tripId)}/load-list`],
  'load.line_check_undone': (e) => [`/api/v1/trips/${String(e.data.tripId)}/load-list`],
  'load.flag_resolved': (e) => [`/api/v1/trips/${String(e.data.tripId)}/load-list`],
  'load.flag_decided': (e) => [`/api/v1/trips/${String(e.data.tripId)}/load-list`, '/api/v1/depots'],
  'trip.released': (e) => [`/api/v1/trips/${e.aggregate.id}`, '/api/v1/depots'],
  // The live day (01, 19, 19a) lives under /depots/{id}/tracking.
  'stop.completed': (e) => [`/api/v1/trips/${String(e.data.tripId)}`, '/api/v1/orders', '/api/v1/depots'],
  'eta.updated': (e) => [`/api/v1/trips/${String(e.data.tripId)}`, `/api/v1/orders/${String(e.data.orderId)}/eta`],
  'alert.raised': () => ['/api/v1/alerts'],
  // So another dispatcher's 01 shows who is on it without a reload (AC-ALR-08).
  'alert.acknowledged': () => ['/api/v1/alerts'],
  'alert.resolved': () => ['/api/v1/alerts'],
  'deferral.decided': () => ['/api/v1/deferrals', '/api/v1/orders'],
  // 21 follows the day as trips finish, and every screen sees the plan lock when it closes.
  'trip.completed': () => ['/api/v1/plans', '/api/v1/depots'],
  'trip.started': () => ['/api/v1/depots'],
  'stop.arrived': () => ['/api/v1/depots'],
  // 19a, 19b and 20 follow another dispatcher's change to the same trip.
  'trip.reassigned': (e) => ['/api/v1/plans', `/api/v1/trips/${e.aggregate.id}`],
  'trip.resequenced': (e) => ['/api/v1/plans', `/api/v1/trips/${e.aggregate.id}`],
  'stop.deferred': (e) => ['/api/v1/plans', '/api/v1/deferrals', `/api/v1/trips/${String(e.data.tripId)}`],
  // A breakdown: 01, 19 and 20 show the trip can't run and the vehicle's status.
  'trip.cant_run': () => ['/api/v1/plans', '/api/v1/depots', '/api/v1/trips'],
  'trip.downloaded': () => ['/api/v1/depots'],
  // 19's "no signal" estimate and the VEHICLE_OFFLINE alert come and go with these.
  'vehicle.offline': () => ['/api/v1/depots', '/api/v1/alerts'],
  'vehicle.back_online': () => ['/api/v1/depots', '/api/v1/alerts'],
  'vehicle.status_changed': () => ['/api/v1/vehicles', '/api/v1/depots', '/api/v1/plans'],
  'stop.failed': () => ['/api/v1/plans', '/api/v1/depots'],
  'plan.closed': () => ['/api/v1/plans', '/api/v1/depots', '/api/v1/deferrals', '/api/v1/orders'],
  // 23, M4 and M7 follow a deferral as it is confirmed, answered, replied to or reversed.
  'deferral.confirmed': () => ['/api/v1/deferrals', '/api/v1/orders'],
  'deferral.store_responded': () => ['/api/v1/deferrals'],
  'deferral.replied': () => ['/api/v1/deferrals'],
  'deferral.reversed': () => ['/api/v1/deferrals', '/api/v1/orders'],
  // 02: the bell's badge and list follow new and read notifications, on every tab.
  'notification.created': () => ['/api/v1/me/notifications'],
  'notification.read': () => ['/api/v1/me/notifications'],
  // 22 redraws when a forecast is imported.
  'forecast.updated': (e) => [`/api/v1/depots/${String(e.routing.depotId)}/forecasts`],
  'clock.changed': () => ['/api/v1/clock'],
  // A setting is read into other resources: the cutoff into an order's editableUntil and a depot's
  // day, the planning rules into a plan's context, the release temperature into a load list.
  'settings.changed': () => ['/api/v1/settings', '/api/v1/orders', '/api/v1/depots', '/api/v1/plans', '/api/v1/trips'],
  // A4's cutoff override and docks, and A3's delivery windows, show on orders and plans too.
  'depot.updated': () => ['/api/v1/depots', '/api/v1/orders'],
  'depot.waves_updated': () => ['/api/v1/depots'],
  'outlet.updated': () => ['/api/v1/outlets', '/api/v1/orders'],
  'identity.user.role_changed': () => ['/api/v1/me'],
  'identity.user.deactivated': () => ['/api/v1/me'],
  'identity.user.scope_changed': () => ['/api/v1/me'],
  'identity.user.reactivated': () => ['/api/v1/users'],
  'identity.user.invited': () => ['/api/v1/users', '/api/v1/invitations'],
  'identity.user.joined': () => ['/api/v1/users', '/api/v1/invitations'],
  'identity.user.pin_set': () => ['/api/v1/users'],
  'identity.invitation.revoked': () => ['/api/v1/invitations'],
  'identity.device.dock_changed': () => ['/api/v1/devices', '/api/v1/me'],
}

/** Positions move constantly; frame 19 reads them off the bus instead of refetching. */
const LIVE_ONLY = ['vehicle.position']

export const EVENT_STREAM_URL = '/api/v1/streams/me'

/**
 * One SSE connection per shell. The browser reconnects on its own and sends Last-Event-ID, so the
 * server replays what was missed; a `resync` frame means the replay window was too old and the
 * whole cache is stale (specs/realtime/spec.md, AC-RT-06).
 */
export function useEventStream(): void {
  const qc = useQueryClient()

  useEffect(() => {
    // jsdom and old browsers have no EventSource; the app still works, it just stops being live.
    if (typeof EventSource === 'undefined') return

    const source = new EventSource(EVENT_STREAM_URL, { withCredentials: true })

    const onEvent = (message: MessageEvent<string>) => {
      const parsed: unknown = JSON.parse(message.data)
      if (!isDomainEvent(parsed)) return
      const paths = INVALIDATES[parsed.type]?.(parsed) ?? []
      if (paths.length > 0) {
        void qc.invalidateQueries({
          predicate: (query) => {
            const [key] = query.queryKey
            return typeof key === 'string' && paths.some((path) => key.startsWith(path))
          },
        })
      }
      eventBus.emit(parsed)
    }

    const types = [...Object.keys(INVALIDATES), ...LIVE_ONLY]
    for (const type of types) source.addEventListener(type, onEvent)
    const onResync = () => void qc.invalidateQueries()
    source.addEventListener('resync', onResync)

    return () => {
      for (const type of types) source.removeEventListener(type, onEvent)
      source.removeEventListener('resync', onResync)
      source.close()
    }
  }, [qc])
}
