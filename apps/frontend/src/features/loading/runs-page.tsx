// Figma: L2m-a Runs · 254:1306 (phone 390 × 844)
import { useLoadingBoardRuns, useMeGet } from '@compass/api-client'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { serverNow, useServerClock } from '@/lib/server-clock'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { DockOfflineBanner } from './dock-offline-banner'
import { TripRow } from './trip-row'

/**
 * L2m-a, the dock's day on a phone: every run grouped by its wave, so a loader walking the bay
 * sees what is loading now and what is next without opening each trip.
 *
 * Trips with no wave are a group of their own, labelled by the server, because the fresh runs that
 * leave at 03:30 belong to nobody's wave and would otherwise vanish from the board.
 */
export function RunsPage() {
  const { t } = useTranslation()
  const { now } = useServerClock(60_000)
  const me = useMeGet()
  const depotId = me.data?.data.depotId ?? undefined
  const date = toColomboDate(serverNow())
  const runs = useLoadingBoardRuns(depotId ?? '', { date }, { query: { enabled: Boolean(depotId) } })
  const groups = runs.data?.data ?? []
  const trips = groups.flatMap((group) => group.trips)

  return (
    <div data-slot="runs" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-px flex-1 flex-col gap-0.5">
          <h1 className="type-heading m-0 text-foreground">{t('loading.runsTitle')}</h1>
          <p className="type-body m-0 text-muted-foreground">
            {t('loading.runsSubtitle', { name: me.data?.data.name ?? '', date: formatColombo(now, 'EEE d MMM') })}
          </p>
        </div>
      </div>

      <DockOfflineBanner />

      {runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : runs.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[76px] w-full" />
          <Skeleton className="h-[76px] w-full" />
          <Skeleton className="h-[76px] w-full" />
        </div>
      ) : trips.length === 0 ? (
        <EmptyState title={t('loading.noRunsTitle')} description={t('loading.noRunsBody')} />
      ) : (
        groups.map((group) => (
          <section key={group.waveId ?? group.label} className="flex flex-col gap-1.5">
            {groups.length > 1 ? <h2 className="type-label m-0 uppercase text-muted-foreground">{group.label}</h2> : null}
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-border p-0">
              {group.trips.map((trip) => (
                <li key={trip.id} className="border-t border-slate-100 first:border-t-0">
                  <Link
                    to={`/dock/trips/${trip.id}`}
                    className="flex flex-col gap-1.5 px-5 pb-[14px] pt-[15px] no-underline outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <TripRow trip={trip} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
