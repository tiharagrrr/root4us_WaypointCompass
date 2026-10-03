// Figma: L2 Loading list · 185:19377 (Panel / Runs · Peliyagoda dock, the 320 px rail)
import { useLoadingBoardTrips } from '@compass/api-client'
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { isDepot } from '@/app/layouts/depot-context'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { TripRow } from './trip-row'

export interface RunsRailProps {
  depotId: string | undefined
  /** The day the dock is loading, as a Colombo business date. */
  date: string
  className?: string
}

/**
 * Every trip on this dock today, so a loader who finishes one walks to the next without going back
 * to a menu. The trip being loaded is marked down the left edge, as on the frame.
 */
export function RunsRail({ depotId, date, className }: RunsRailProps) {
  const { t } = useTranslation()
  const query = useLoadingBoardTrips(depotId ?? '', { date }, { query: { enabled: Boolean(depotId) } })
  const trips = query.data?.data ?? []
  const depot = isDepot(depotId) ? DEPOT_NAMES[depotId] : null

  return (
    <nav data-slot="runs-rail" aria-label={t('loading.runsOf', { depot: depot ?? '' })} className={cn('flex w-[320px] shrink-0 flex-col border-r border-border', className)}>
      <p className="type-label m-0 flex h-11 items-center px-5 uppercase text-muted-foreground">
        {t('loading.runsOf', { depot: depot ?? '' })}
      </p>
      {query.isError ? (
        <div className="border-t border-slate-100 p-4">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : query.isPending ? (
        <div className="flex flex-col gap-3 border-t border-slate-100 p-5">
          <Skeleton className="h-[52px] w-full" />
          <Skeleton className="h-[52px] w-full" />
          <Skeleton className="h-[52px] w-full" />
        </div>
      ) : trips.length === 0 ? (
        <EmptyState className="px-5 py-10" title={t('loading.noRunsTitle')} description={t('loading.noRunsBody')} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {trips.map((trip) => (
            <li key={trip.id}>
              <NavLink
                to={`/dock/trips/${trip.id}`}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col gap-1.5 border-t border-slate-100 px-5 pb-[14px] pt-[15px] no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    isActive ? 'bg-accent shadow-[inset_3px_0_0_0_var(--color-primary)]' : 'hover:bg-slate-50',
                  )
                }
              >
                <TripRow trip={trip} />
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
