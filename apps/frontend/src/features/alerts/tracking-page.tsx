// Figma: 19 Tracking · 185:17224
import { useDepot } from '@/app/layouts/depot-context'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { LiveTripsList } from '@/features/planning/live-trips-list'
import { AlertsColumn } from './alerts-column'

/**
 * 19, live runs. Three columns: the day's trips with their progress and next
 * arrival (planning's live day), the map, and alerts' column on the right.
 *
 * The map waits on vehicle positions: nothing writes `vehicle_positions` yet
 * (ROO-37), and outlets have no coordinates.
 */
export function TrackingPage() {
  const { depot } = useDepot()

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      <LiveTripsList depotId={depot} />
      <RegionPlaceholder
        region="Live map"
        frame="19"
        node="185:17224"
        owner="execution"
        what="Vehicle positions, delivered and upcoming stops, roadworks. Waits on position ingest (ROO-37) and outlet coordinates."
      />
      <AlertsColumn depotId={depot} />
    </div>
  )
}
