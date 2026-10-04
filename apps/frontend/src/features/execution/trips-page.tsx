// Figma: D10 Trips · 245:828
import { useMeGet, useMyTripsList, type TripSummaryDto } from '@compass/api-client'
import { addDays, instantAt } from '@waypoint/shared'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { useServerClock } from '@/lib/server-clock'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip, type StatusTone } from '@/ui/status-chip'
import { tripTimes, tripTitle } from './trip-copy'

const TONE_OF: Record<string, StatusTone> = {
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'muted',
}

/** The trips of each business date, newest date first and the later run above the earlier. */
function byDay(trips: readonly TripSummaryDto[]): [string, TripSummaryDto[]][] {
  const days = new Map<string, TripSummaryDto[]>()
  for (const trip of trips) days.set(trip.date, [...(days.get(trip.date) ?? []), trip])
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => [date, [...list].sort((a, b) => (b.tripNo ?? 0) - (a.tripNo ?? 0))])
}

/**
 * D10: the driver's own trips for the last 7 days, which is as far back as the API lets her read
 * (AC-EXE-02), grouped by day. Each card opens D11, the record of that round.
 */
export function TripsPage() {
  const { t } = useTranslation()
  const { now } = useServerClock(60_000)
  const today = toColomboDate(now)
  const me = useMeGet()
  const trips = useMyTripsList()
  const list = trips.data?.data ?? []

  const dayLabel = (date: string): string => {
    const label = formatColombo(instantAt(date, 720), 'EEE d MMM')
    if (date === today) return `${t('driver.today')} · ${label}`
    if (date === addDays(today, -1)) return `${t('driver.yesterday')} · ${label}`
    return label
  }

  const vehicle = list.at(-1)?.vehicle.code
  const stops = list.reduce((sum, trip) => sum + trip.stops, 0)
  const completed = list.filter((trip) => trip.status === 'COMPLETED').length

  return (
    <>
      <header className="-mx-4 flex flex-col gap-0.5 border-b border-border px-4 pb-3">
        <h1 className="type-heading m-0 text-foreground">{t('nav.trips')}</h1>
        <p className="type-body m-0 text-muted-foreground">{[me.data?.data.name, vehicle].filter(Boolean).join(' · ')}</p>
      </header>

      {trips.isError ? (
        <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
      ) : trips.isPending ? (
        <TripsSkeleton />
      ) : list.length === 0 ? (
        <EmptyState title={t('driver.noTripsTitle')} description={t('driver.noTripsBody')} />
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h2 className="type-label m-0 uppercase text-muted-foreground">{t('driver.last7Days')}</h2>
            <dl className="m-0 flex rounded-lg border border-slate-200 bg-page px-4 py-3">
              <Figure label={t('nav.trips')} value={String(list.length)} />
              <Figure label={t('driver.stops')} value={String(stops)} />
              <Figure label={t('driver.completed')} value={String(completed)} />
            </dl>
          </section>

          {byDay(list).map(([date, dayTrips]) => (
            <section key={date} aria-label={dayLabel(date)} className="flex flex-col gap-2">
              <h2 className="type-label m-0 uppercase text-muted-foreground">{dayLabel(date)}</h2>
              {dayTrips.map((trip) => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </section>
          ))}

          <p className="type-caption m-0 text-center text-muted-foreground">{t('driver.showingLast7Days')}</p>
        </div>
      )}
    </>
  )
}

function TripCard({ trip }: { trip: TripSummaryDto }) {
  const { t } = useTranslation()
  const recorded = trip.stops - trip.openStops
  return (
    <RouterLink
      to={`/driver/trips/${trip.id}`}
      className="flex min-h-(--compass-size-touch-target) items-center gap-3 rounded-lg border border-border bg-background py-3 pr-3 pl-4 no-underline outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-card-title text-foreground">{tripTitle(trip)}</span>
        <span className="type-body-small text-muted-foreground">
          {tripTimes(trip, t)} · {t('driver.stopCount', { count: trip.stops })}
        </span>
        {trip.startedAt ? (
          <span className="type-body-small text-slate-700">{t('driver.stopsRecorded', { done: recorded, total: trip.stops })}</span>
        ) : null}
        <span className="flex pt-1.5">
          <StatusChip tone={TONE_OF[trip.status] ?? 'neutral'}>{trip.status.replace(/_/g, ' ')}</StatusChip>
        </span>
      </span>
      <Icon name="chevron-right" size={18} className="shrink-0 text-muted-foreground" />
    </RouterLink>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <dt className="type-label m-0 uppercase text-muted-foreground">{label}</dt>
      <dd className="type-heading m-0 text-foreground">{value}</dd>
    </div>
  )
}

function TripsSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-[74px] w-full rounded-lg" />
      <Skeleton className="h-[104px] w-full rounded-lg" />
      <Skeleton className="h-[104px] w-full rounded-lg" />
    </div>
  )
}
