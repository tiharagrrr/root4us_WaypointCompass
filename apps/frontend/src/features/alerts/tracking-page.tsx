// Figma: 19 Tracking · 185:17224
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { useDepot } from '@/app/layouts/depot-context'
import { LiveMap } from '@/features/execution/live-map/live-map'
import { LiveTripsList } from '@/features/planning/live-trips-list'
import { AlertsColumn } from './alerts-column'

/**
 * 19, live runs. Three columns: the day's trips with their progress and next
 * arrival (planning's live day), execution's live map, and alerts' column on
 * the right.
 */
export function TrackingPage() {
  const { depot } = useDepot()

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      <LiveTripsList depotId={depot} />
      <LiveMap depotId={depot} depotName={DEPOT_NAMES[depot] ?? depot} />
      <AlertsColumn depotId={depot} />
    </div>
  )
}
