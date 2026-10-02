// Figma: 19 Tracking · 185:17224
import { useDepot } from '@/app/layouts/depot-context'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { AlertsColumn } from './alerts-column'

/**
 * 19, live runs. Three columns: the trip list, the map, and the alerts column
 * on the right, which is alerts' own (specs/frontend/screens.md lists 19
 * under execution and alerts).
 *
 * The trip list and the live map are execution's and belong to 19's owner.
 */
export function TrackingPage() {
  const { depot } = useDepot()

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      <RegionPlaceholder
        region="Trips on the road"
        frame="19"
        node="185:17224"
        owner="execution"
        what="Each trip's progress, next ETA and window, picked to drive the map."
      />
      <RegionPlaceholder
        region="Live map"
        frame="19"
        node="185:17224"
        owner="execution"
        what="Vehicle positions over SSE, delivered and upcoming stops, roadworks."
      />
      <AlertsColumn depotId={depot} />
    </div>
  )
}
