// Figma: D11 Past trip · 245:1009
import { getStopsGetQueryOptions, useTripsBundle, useTripsGet, type StopDto } from '@compass/api-client'
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { instantAt } from '@waypoint/shared'
import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useParams } from 'react-router'
import { useCachedStops } from '@/offline'
import { formatColombo } from '@/lib/format-colombo'
import { Card, CardContent } from '@/ui/card'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip, type StatusTone } from '@/ui/status-chip'
import { tripTimes, tripTitle } from './trip-copy'

/** The frame draws DELIVERED neutral and PARTIAL red; a stop nobody recorded stays muted. */
const TONE_OF: Record<string, StatusTone> = {
  DELIVERED: 'neutral',
  PARTIAL: 'danger',
  FAILED: 'danger',
  PENDING: 'muted',
  ARRIVED: 'muted',
}

const time = (instant: string): string => formatColombo(instant, 'HH:mm')

interface StopRow {
  id: string
  seq: number
  name: string
  status: string
}

/**
 * D11: the record of one round, for settling a dispute — what was delivered where, when, and who
 * took it. The trip and its stops come from the API, which serves a driver her own last 7 days
 * (AC-EXE-02); with no signal, a trip this phone ran still lists its stops from Dexie, without the
 * times and receivers only the server holds.
 */
export function PastTripPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const trip = useTripsGet(id)
  const bundle = useTripsBundle(id)
  const cached = useCachedStops(id)

  const rows: StopRow[] = bundle.data
    ? bundle.data.data.stops.map((stop, index) => ({ id: stop.id, seq: stop.seq ?? index + 1, name: stop.outlet.name, status: stop.status }))
    : cached.map((stop) => ({ id: stop.id, seq: stop.sequence, name: stop.outletName, status: stop.status }))
  const details = useQueries({
    queries: rows.map((row) => getStopsGetQueryOptions(row.id, { query: { enabled: bundle.isSuccess } })),
  })

  const back = (
    <RouterLink
      to="/driver/trips"
      aria-label={t('driver.back')}
      className="flex size-(--compass-size-touch-target) shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Icon name="back" size={22} />
    </RouterLink>
  )

  if (trip.isError)
    return (
      <>
        <header className="-mx-4 flex items-center gap-2.5 border-b border-border px-4 pb-3">{back}</header>
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      </>
    )
  if (trip.isPending) return <PastTripSkeleton />

  const summary = trip.data.data
  const count = (status: string) => rows.filter((row) => row.status === status).length
  const vehicleRows: readonly { label: string; value: string }[] = [
    {
      label: summary.startedAt ? t('driver.departed') : t('driver.departs'),
      value: `${summary.startedAt ? time(summary.startedAt) : summary.plannedDepartAt ? time(summary.plannedDepartAt) : '—'} · ${DEPOT_NAMES[summary.depotId as keyof typeof DEPOT_NAMES] ?? summary.depotId}`,
    },
    { label: t('driver.finished'), value: summary.completedAt ? time(summary.completedAt) : '—' },
  ]

  return (
    <>
      <header className="-mx-4 flex items-center gap-2.5 border-b border-border px-4 pb-3">
        {back}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="type-heading m-0 text-foreground">{tripTitle(summary)}</h1>
          <p className="type-body-small m-0 text-muted-foreground">
            {formatColombo(instantAt(summary.date, 720), 'EEE d MMM')} · {tripTimes(summary, t)}
          </p>
        </div>
      </header>

      <dl className="m-0 grid grid-cols-2 gap-2">
        <Stat label={t('driver.delivered')} value={String(count('DELIVERED'))} />
        <Stat label={t('driver.partial')} value={String(count('PARTIAL'))} />
        <Stat label={t('driver.failedStops')} value={String(count('FAILED'))} />
        <Stat label={t('driver.stops')} value={String(summary.stops)} />
      </dl>

      <Card className="w-full">
        <CardContent className="flex flex-col gap-0.5 px-4 py-3.5">
          <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.vehicle')}</p>
          <div className="flex gap-1.5 pt-1.5 pb-1">
            <StatusChip tone="muted">{summary.vehicle.temp}</StatusChip>
            <span className="type-metadata self-center text-muted-foreground">{summary.vehicle.code}</span>
          </div>
          <dl className="m-0 flex flex-col">
            {vehicleRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-[9px] pb-2">
                <dt className="type-body-small m-0 text-muted-foreground">{row.label}</dt>
                <dd className="type-body-strong m-0 text-right text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <section className="flex w-full flex-col">
        <h2 className="type-label m-0 pb-1 uppercase text-muted-foreground">{t('driver.stopsAndProof')}</h2>
        {bundle.isPending && rows.length === 0 ? (
          <Skeleton className="h-[180px] w-full" />
        ) : bundle.isError && rows.length === 0 ? (
          <ErrorState error={bundle.error} onRetry={() => void bundle.refetch()} />
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {rows.map((row, index) => (
              <StopLine key={row.id} row={row} chilled={summary.tempClass === 'CHILLED'} detail={details[index]?.data?.data} />
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

function StopLine({ row, chilled, detail }: { row: StopRow; chilled: boolean; detail: StopDto | undefined }) {
  const { t } = useTranslation()
  const at = detail?.completedAt ?? detail?.arrivedAt
  // A failed or short stop says why; a clean one says who signed for it.
  const said = row.status === 'DELIVERED' ? detail?.receiverName : (detail?.exceptionNote ?? detail?.receiverName)
  const line = [at ? time(at) : null, said].filter(Boolean).join(' · ')
  return (
    <li className="flex items-start border-t border-slate-100 pt-[11px] pb-2.5">
      <span className="type-data-bold w-[25px] shrink-0 text-muted-foreground">{row.seq}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          {chilled ? <Icon name="leaf" size={14} className="shrink-0 text-teal-700" /> : null}
          <span className="type-body-medium truncate text-foreground">{row.name}</span>
        </span>
        <span className="type-body-small text-muted-foreground">{line || t('driver.nothingRecorded')}</span>
      </span>
      <StatusChip tone={TONE_OF[row.status] ?? 'neutral'}>{row.status}</StatusChip>
    </li>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3.5 py-3 shadow-xs">
      <dt className="type-label m-0 uppercase text-muted-foreground">{label}</dt>
      <dd className="m-0 font-sans text-[26px] leading-none font-bold text-foreground">{value}</dd>
    </div>
  )
}

function PastTripSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-11 w-2/3" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[150px] w-full rounded-lg" />
      <Skeleton className="h-[180px] w-full" />
    </div>
  )
}
