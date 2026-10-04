import { useCallback, useState } from 'react'
import { useDomainEvent, type DomainEvent } from '@/realtime/event-bus'
import type { LivePosition } from './map-model'

const TYPES = ['vehicle.position'] as const

/**
 * The newest position per trip from the event stream. Positions never refetch the tracking read
 * (useEventStream keeps them off the query cache); the map patches them in as they arrive, at
 * most one per vehicle every 5 seconds.
 */
export function useLivePositions(): ReadonlyMap<string, LivePosition> {
  const [positions, setPositions] = useState<ReadonlyMap<string, LivePosition>>(() => new Map())
  const onPosition = useCallback((event: DomainEvent) => {
    const d = event.data
    if (typeof d.tripId !== 'string' || typeof d.lat !== 'number' || typeof d.lng !== 'number') return
    const next: LivePosition = {
      lat: d.lat,
      lng: d.lng,
      heading: typeof d.heading === 'number' ? d.heading : null,
      recordedAt: typeof d.recordedAt === 'string' ? d.recordedAt : event.occurredAt,
    }
    const tripId = d.tripId
    setPositions((current) => {
      const had = current.get(tripId)
      if (had && had.recordedAt >= next.recordedAt) return current
      const copy = new Map(current)
      copy.set(tripId, next)
      return copy
    })
  }, [])
  useDomainEvent(TYPES, onPosition)
  return positions
}
