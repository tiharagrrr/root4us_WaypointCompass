// Figma: 19a Trip details · 464:1966 (the LATE RISK chip beside "REF-07 · Trip 1")
import { StatusChip, type StatusTone } from '@/ui/status-chip'
import { ALERT_TYPE_LABELS, alertTone } from './alert-copy'
import { useDepotAlerts } from './use-depot-alerts'

export interface TripAlertChipsProps {
  depotId: string
  tripId: string
}

/**
 * The trip's open alerts as chips, in 19a's header. One chip per kind, worst
 * first, so a trip that is both late and out of signal says so twice rather
 * than picking a winner.
 *
 * The chip carries the kind as its text, not just its colour, which is both
 * the frame's design and the rule that status is never colour alone.
 */
export function TripAlertChips({ depotId, tripId }: TripAlertChipsProps) {
  const { open, isPending } = useDepotAlerts({ depotId, tripId, status: 'OPEN,ACKNOWLEDGED', limit: 20 })
  if (isPending || open.length === 0) return null

  const seen = new Set<string>()
  const chips = open
    .filter((alert) => !seen.has(alert.type) && seen.add(alert.type))
    .map((alert) => ({ type: alert.type, tone: alertTone(alert) as StatusTone }))

  return (
    <div data-slot="trip-alert-chips" className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ type, tone }) => (
        <StatusChip key={type} tone={tone}>
          {ALERT_TYPE_LABELS[type]}
        </StatusChip>
      ))}
    </div>
  )
}
