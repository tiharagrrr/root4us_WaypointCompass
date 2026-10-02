// Figma: 19a Trip details · 464:1966
import { Link as RouterLink, useParams } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { Card, CardContent } from '@/ui/card'
import { AlertsColumn } from './alerts-column'
import { TripAlertChips } from './trip-alert-chips'

/**
 * 19a, one trip. The frame keeps 19's trip list and map and swaps the right
 * column for the trip's own detail; alerts' part is the chips in its header
 * and the trip's alerts beneath (`GET /alerts?filter[tripId]=`).
 *
 * The stop timeline, the trip load and the Reassign and Re-sequence buttons
 * at the foot of the frame are execution's and planning's.
 */
export function TripDetailsPage() {
  const { depot } = useDepot()
  const { id } = useParams<{ id: string }>()
  if (!id) return null

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      <RegionPlaceholder
        region="Trips on the road"
        frame="19a"
        node="464:1966"
        owner="execution"
        what="The same list as 19, with this trip selected."
      />
      <RegionPlaceholder
        region="Live map"
        frame="19a"
        node="464:1966"
        owner="execution"
        what="The trip's route, its breadcrumb and the stops still to come."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <RouterLink to="/dispatch/tracking" className="type-body text-primary hover:underline">
                ← All runs
              </RouterLink>
              <TripAlertChips depotId={depot} tripId={id} />
            </div>
            <p className="type-body m-0 text-muted-foreground">
              What is wrong with this trip, and what would fix it.
            </p>
          </CardContent>
        </Card>

        <AlertsColumn depotId={depot} tripId={id} />

        <RegionPlaceholder
          region="Stop timeline"
          frame="19a"
          node="464:1966"
          owner="execution"
          what="Planned, ETA and actual per stop, with the trip load above it."
        />
      </div>
    </div>
  )
}
