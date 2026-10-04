// Figma: 19 Live runs · 185:17224 (the map) and 19a Trip details · 464:1966
import { useMemo } from 'react'
import { Card } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { useLiveDay } from '@/features/planning/live-day'
import { MapCanvas } from './map-canvas'
import { mapModel } from './map-model'
import { useLivePositions } from './use-live-positions'

/** The legend, in the frame's words and order. */
const LEGEND: { tone: string; label: string }[] = [
  { tone: 'vehicle', label: 'Vehicle now' },
  { tone: 'delivered', label: 'Delivered' },
  { tone: 'upcoming', label: 'Upcoming' },
  { tone: 'at-risk', label: 'At risk' },
  { tone: 'late', label: 'Projected late' },
  { tone: 'no-signal', label: 'Estimate, no signal' },
]

export interface LiveMapProps {
  depotId: string
  depotName: string
  /** 19a's trip: its stops, the legs driven and to come. */
  selectedTripId?: string | null
  date?: string
}

/**
 * 19's and 19a's live map: every trip on the road where it is now, moving as positions arrive on
 * the event stream, and the selected trip's stops in order with how much time each has spare.
 */
export function LiveMap({ depotId, depotName, selectedTripId = null, date }: LiveMapProps) {
  const day = useLiveDay(depotId, date)
  const live = useLivePositions()
  const model = useMemo(
    () => (day.data ? mapModel(day.data.data, depotName, live, selectedTripId) : null),
    [day.data, depotName, live, selectedTripId],
  )

  return (
    <Card className="overflow-hidden p-0" aria-label="Live map">
      <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-4">
        <p className="type-label m-0 uppercase text-muted-foreground">Live map · vehicle positions</p>
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0" aria-label="Legend">
          {LEGEND.map((item) => (
            <li key={item.tone} className="flex items-center gap-2">
              <span aria-hidden="true" className={`map-dot map-dot-${item.tone}`} />
              <span className="type-body text-foreground">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative h-[560px]">
        {day.isPending ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : day.isError ? (
          <ErrorState className="m-4" error={day.error} onRetry={() => void day.refetch()} />
        ) : model && !model.bounds ? (
          <p className="type-body m-0 p-6 text-muted-foreground">No trips on the road and no outlets on the map yet.</p>
        ) : model ? (
          <MapCanvas model={model} fitKey={`${depotId}:${selectedTripId ?? ''}`} />
        ) : null}
      </div>
    </Card>
  )
}
