// Figma: 19 Tracking · 185:17224
import { useDepot } from '@/app/layouts/depot-context'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { LiveTripsList } from '@/features/planning/live-trips-list'
import { AlertsColumn } from './alerts-column'

// The trips and the alerts can run longer than the screen, so on the three-column layout each
// scrolls inside its own column instead of dragging the map away with the page.
const SCROLL_COLUMN = 'xl:sticky xl:top-4 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto'

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
      <div className={SCROLL_COLUMN}>
        <LiveTripsList depotId={depot} />
      </div>
      <RegionPlaceholder
        region="Live map"
        frame="19"
        node="185:17224"
        owner="execution"
        what="Vehicle positions, delivered and upcoming stops, roadworks. Waits on position ingest (ROO-37) and outlet coordinates."
      />
      <div className={SCROLL_COLUMN}>
        <AlertsColumn depotId={depot} />
      </div>
    </div>
  )
}
