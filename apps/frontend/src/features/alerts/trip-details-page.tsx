// Figma: 19a Trip details · 464:1966
import { useParams } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { Card, CardContent } from '@/ui/card'
import { LiveTripsList } from '@/features/planning/live-trips-list'
import { StopTimeline } from '@/features/planning/stop-timeline'
import { TripOperationsCard } from '@/features/planning/trip-operations-card'
import { AlertsColumn } from './alerts-column'
import { TripAlertChips } from './trip-alert-chips'

/**
 * 19a, one trip. The frame keeps 19's trip list and map and swaps the right
 * column for the trip's own detail: its stops planned, projected and actual
 * (planning's live day), what can be changed (20 and 19b), and alerts' chips
 * and the trip's alerts (`GET /alerts?filter[tripId]=`).
 */
export function TripDetailsPage() {
  const { depot } = useDepot()
  const { id } = useParams<{ id: string }>()
  if (!id) return null

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
      <LiveTripsList depotId={depot} selectedId={id} />
      <RegionPlaceholder
        region="Live map"
        frame="19a"
        node="464:1966"
        owner="execution"
        what="The trip's route, its breadcrumb and the stops still to come. Waits on position ingest (ROO-37) and outlet coordinates."
      />

      <div className="flex flex-col gap-4">
        <StopTimeline depotId={depot} tripId={id} />
        <TripOperationsCard tripId={id} />
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="type-card-title text-foreground">Alerts on this trip</span>
              <TripAlertChips depotId={depot} tripId={id} />
            </div>
          </CardContent>
        </Card>
        <AlertsColumn depotId={depot} tripId={id} />
      </div>
    </div>
  )
}
