// Figma: 01 Dashboard · 488:8577
import { useMeGet } from '@compass/api-client'
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { Link as RouterLink } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { RegionPlaceholder } from '@/app/screen-placeholder'
import { formatColombo } from '@/lib/format-colombo'
import { useServerClock } from '@/lib/server-clock'
import { Button } from '@/ui/button'
import { KpiRow, TodaysRuns } from '@/features/planning/day-summary'
import { ExceptionBanner } from './exception-banner'
import { NeedsAttentionCard } from './needs-attention-card'

/** "Good morning", "Good afternoon" or "Good evening", by the server's Colombo time. */
const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')

/**
 * 01, the dispatcher's morning. The frame has four regions and alerts owns
 * two of them: the exception banner across the top and "Needs Attention" down
 * the right (specs/frontend/screens.md lists 01 under alerts and planning).
 *
 * The KPI row and today's runs are planning's live day (GET /depots/{id}/tracking);
 * tomorrow's cutoff card is ordering's and still marked.
 */
export function DashboardPage() {
  const { depot } = useDepot()
  const { now } = useServerClock(60_000)
  const first = useMeGet().data?.data.name.split(' ')[0]
  usePageHeader({
    eyebrow: formatColombo(now, 'EEE d MMM · HH:mm'),
    title: first ? `${greeting(Number(formatColombo(now, 'H')))}, ${first}` : 'Dashboard',
  })

  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <Button asChild variant="outline">
          <RouterLink to="/dispatch/tracking">Open tracking</RouterLink>
        </Button>
      </HeaderActions>
      <ExceptionBanner depotId={depot} />

      <KpiRow depotId={depot} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_368px]">
        <TodaysRuns depotId={depot} depotName={DEPOT_NAMES[depot] ?? depot} />
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
