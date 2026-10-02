// Figma: 01 Dashboard · 488:8577
import { useDepot } from '@/app/layouts/depot-context'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { ExceptionBanner } from './exception-banner'
import { NeedsAttentionCard } from './needs-attention-card'

/**
 * 01, the dispatcher's morning. The frame has four regions and alerts owns
 * two of them: the exception banner across the top and "Needs Attention" down
 * the right (specs/frontend/screens.md lists 01 under alerts and planning).
 *
 * The KPI row, today's runs and tomorrow's cutoff card are planning's and
 * belong to 01's owner; they are marked here rather than sketched, so nobody
 * builds the real ones on top of a guess.
 */
export function DashboardPage() {
  const { depot } = useDepot()

  return (
    <div className="flex flex-col gap-4">
      <ExceptionBanner depotId={depot} />

      <RegionPlaceholder
        region="KPI row"
        frame="01"
        node="488:8577"
        owner="planning"
        what="Trips on the road, stops delivered, late risk and deferred today."
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_368px]">
        <RegionPlaceholder
          region="Today's runs"
          frame="01"
          node="488:8577"
          owner="planning"
          what="The day's trips with vehicle, driver, stops, next ETA and status."
        />
        <div className="flex flex-col gap-4">
          <NeedsAttentionCard depotId={depot} />
          <RegionPlaceholder
            region="Tomorrow's cutoff"
            frame="01"
            node="488:8577"
            owner="ordering"
            what="Orders received so far against chilled, weight and volume capacity."
          />
        </div>
      </div>
    </div>
  )
}
