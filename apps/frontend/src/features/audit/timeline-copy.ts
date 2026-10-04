import type { TimelineEntryDto } from '@compass/api-client'

/** What each audited step is called on the timeline; anything else is spelled from its action. */
const ACTION_WORDS: Record<string, string> = {
  'ordering.order.created': 'Draft started',
  'ordering.order.updated': 'Order edited',
  'ordering.order.lines_changed': 'Items changed',
  'ordering.order.submitted': 'Order submitted',
  'ordering.order.confirmed': 'Order confirmed at cutoff',
  'ordering.order.cancelled': 'Order cancelled',
  'ordering.order.priority_changed': 'Priority changed',
  'ordering.order.reordered': 'Reordered from history',
  'ordering.order.backordered': 'Backorder created',
  'ordering.order.stop_changed': 'Moved to another stop',
  'planning.deferral.confirmed': 'Deferred by the dispatcher',
  'planning.deferral.repeat_skip_overridden': 'Repeat skip overridden',
  'planning.deferral.store_responded': 'Store responded to the deferral',
  'planning.deferral.replied': 'Dispatcher replied',
  'planning.deferral.reversed': 'Deferral reversed',
  'planning.order.swapped': 'Swapped onto the plan',
  'planning.stop.deferred': 'Stop deferred',
  'planning.trip.reassigned': 'Trip reassigned',
  'planning.trip.resequenced': 'Stops resequenced',
  'planning.trip.cancelled': 'Trip cancelled',
  'loading.list.built': 'Load list built',
  'loading.line.checked': 'Item loaded',
  'loading.line.check_undone': 'Load check undone',
  'loading.flag.raised': 'Loading problem flagged',
  'loading.flag.undone': 'Flag removed',
  'loading.flag.decided': 'Flag decided',
  'loading.flag.rechecked': 'Flag rechecked',
  'loading.trip.released': 'Vehicle released',
  'execution.trip.downloaded': 'Trip downloaded to the phone',
  'execution.trip.started': 'Trip started',
  'execution.trip.cant_run': 'Driver could not run the trip',
  'execution.trip.completed': 'Trip completed',
  'execution.stop.arrived': 'Driver arrived',
  'execution.stop.completed': 'Delivered',
  'execution.stop.partial': 'Partly delivered',
  'execution.stop.failed': 'Delivery failed',
  'receipt.confirmed': 'Receipt confirmed',
  'receipt.reconciled': 'Receipt matched to the delivery',
  'receipt.issue.reported': 'Issue reported',
  'receipt.issue.commented': 'Comment on the issue',
  'receipt.issue.resolved': 'Issue resolved',
  'receipt.issue.reopened': 'Issue reopened',
  'receipt.issue.photo_added': 'Photo added to the issue',
}

const ENTITY_WORDS: Record<string, string> = { order: 'Order', trip: 'Trip', stop: 'Stop' }

export const ROLE_WORDS: Record<string, string> = {
  store_manager: 'Store',
  dispatcher: 'Dispatcher',
  loader: 'Loader',
  driver: 'Driver',
  admin: 'Admin',
}

const SOURCE_WORDS: Record<string, string> = {
  PWA: 'Phone',
  OFFLINE_SYNC: 'Offline sync',
  ENGINE: 'Planning engine',
  SYSTEM: 'System',
  SIMULATION: 'Simulation',
  WEBHOOK: 'Webhook',
}

/** 'IN_TRANSIT' and 'store_responded' as words: 'In transit', 'Store responded'. */
const words = (code: string) => {
  const text = code.replace(/_/g, ' ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The step's title: its own words, or the status it set, or the action spelled out. */
export function entryTitle(entry: TimelineEntryDto): string {
  const known = ACTION_WORDS[entry.action]
  if (known) return known
  if (entry.action.endsWith('.status_changed') && entry.status)
    return `${ENTITY_WORDS[entry.entityType] ?? words(entry.entityType)}: ${words(entry.status)}`
  return words(entry.action.split('.').slice(1).join(' '))
}

/** Who did it: the person and their role, or where it came from when nobody did. */
export function entryActor(entry: TimelineEntryDto): string {
  const role = entry.actorRole ? (ROLE_WORDS[entry.actorRole] ?? words(entry.actorRole)) : null
  if (entry.actorName) return role ? `${entry.actorName} · ${role}` : entry.actorName
  return role ?? SOURCE_WORDS[entry.source] ?? 'System'
}

/** Where it came from, when that is not the web app. */
export const entrySource = (entry: TimelineEntryDto): string | null => SOURCE_WORDS[entry.source] ?? null

/** The reason as the person gave it: the code in words, then the note. */
export function entryReason(entry: TimelineEntryDto): string | null {
  const parts = [entry.reasonCode ? words(entry.reasonCode) : null, entry.reasonNote].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}
