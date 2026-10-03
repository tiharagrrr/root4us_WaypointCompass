// Figma: L2 Loading list · 185:19377 (the state behind the Plan updated banner)
import { useCallback, useState } from 'react'
import { serverNow } from '@/lib/server-clock'
import { useDomainEvent, type DomainEvent } from '@/realtime/event-bus'

const EVENTS = ['load.list_updated'] as const

export interface PlanUpdated {
  /** When the plan moved, or null while the tablet is showing the current list. */
  at: Date | null
  acknowledge: () => void
}

/**
 * The dock's half of a plan revision. `load.list_updated` arrives over SSE; a tablet that was
 * asleep when it went out learns the same thing from the list itself, which comes back
 * `upToDate: false` until it is reloaded (AC-LOD-13).
 */
export function usePlanUpdated(tripId: string, listRevision: number | undefined, upToDate: boolean | undefined): PlanUpdated {
  const [at, setAt] = useState<Date | null>(null)
  const [seen, setSeen] = useState<number | null>(null)
  const [lastUpToDate, setLastUpToDate] = useState<boolean | undefined>(upToDate)

  const onUpdated = useCallback(
    (event: DomainEvent) => {
      if (event.data.tripId !== tripId) return
      setAt(new Date(event.occurredAt))
      setSeen(null)
    },
    [tripId],
  )
  useDomainEvent(EVENTS, onUpdated)

  // Adjusted while rendering rather than in an effect, so the banner is on screen with the stale
  // list rather than one paint after it (react.dev, "You might not need an effect").
  if (upToDate !== lastUpToDate) {
    setLastUpToDate(upToDate)
    if (upToDate === false) {
      setAt(serverNow())
      setSeen(null)
    }
  }

  return {
    at: seen !== null && seen === listRevision ? null : at,
    acknowledge: () => {
      setSeen(listRevision ?? null)
      setAt(null)
    },
  }
}
