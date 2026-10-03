// Figma: L5 Trip released · 185:19880 (tablet 1194 × 834, centred) and L5m Trip released ·
// 254:1804 (phone 390 × 844: the same cards full width, from the top of the screen)
import { useLoadingBoardTrips, type LoadListDto } from '@compass/api-client'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatColombo } from '@/lib/format-colombo'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { tempClassLabel } from './loading-copy'

export interface TripReleasedProps {
  list: LoadListDto
  /** The driver's name when the release checks named them. */
  driver?: string | null
}

/**
 * L5. The trip is gone and the dock's question is immediately "what next?", so the next run on
 * this dock is offered on the same screen rather than behind a back button (AC-LOD-16).
 */
export function TripReleased({ list, driver }: TripReleasedProps) {
  const { t } = useTranslation()
  const { trip, progress } = list
  const board = useLoadingBoardTrips(trip.depotId, { date: trip.date })
  const next = (board.data?.data ?? [])
    .filter((candidate) => candidate.id !== trip.id && candidate.status !== 'RELEASED' && candidate.status !== 'CANCELLED')
    .sort((a, b) => (a.plannedDepartAt ?? '').localeCompare(b.plannedDepartAt ?? ''))[0]
  const deferred = list.stops.flatMap((stop) => stop.lines).filter((line) => line.status === 'REMOVED').length

  return (
    <div data-slot="trip-released" className="-m-4 flex flex-1 items-start justify-center bg-page p-5 pt-6 sm:-m-6 sm:items-center sm:p-6">
      <div className="flex w-full flex-col gap-4 sm:w-[520px]">
        <div className="rounded-lg border border-border bg-background shadow-sm">
          <div className="flex flex-col gap-4 p-7">
            <span className="flex size-12 items-center justify-center rounded-full bg-slate-900 text-background">
              <Icon name="check" size={28} />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="type-page-title m-0 text-foreground">{t('loading.released.title', { trip: trip.vehicleId })}</h1>
              <p className="type-body-medium m-0 text-muted-foreground">
                {t('loading.released.subtitle', {
                  time: trip.releasedAt ? formatColombo(trip.releasedAt, 'HH:mm') : '—',
                  driver: driver ?? t('loading.released.theDriver'),
                  count: list.stops.length,
                })}
              </p>
            </div>
            <dl className="m-0 flex flex-col">
              <Row
                label={t('loading.items')}
                value={
                  deferred > 0
                    ? t('loading.released.itemsWithDeferrals', { checked: progress.checked, total: progress.lines, count: deferred })
                    : t('loading.released.items', { checked: progress.checked, total: progress.lines })
                }
              />
              {trip.releaseTempC === null || trip.releaseTempC === undefined ? null : (
                <Row label={t('loading.released.reefer')} value={`${trip.releaseTempC} °C`} />
              )}
              <Row label={t('loading.released.releasedBy')} value={list.releasedByName ?? '—'} />
            </dl>
          </div>
        </div>

        {next ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background px-5 py-4 shadow-sm sm:flex-row sm:items-center">
            <div className="flex min-w-px flex-1 flex-col gap-0.5">
              <p className="type-label m-0 uppercase text-muted-foreground">{t('loading.released.nextOnDock')}</p>
              <p className="type-card-title m-0 text-foreground">
                {t('loading.released.nextTrip', {
                  vehicle: next.vehicleId,
                  tempClass: tempClassLabel(next.tempClass),
                  time: next.plannedDepartAt ? formatColombo(next.plannedDepartAt, 'HH:mm') : '—',
                })}
              </p>
            </div>
            <Button asChild variant="primary" className="h-[52px] w-full px-[21px] text-[16px] sm:w-auto">
              <Link to={`/dock/trips/${next.id}`}>{t('loading.released.startLoading')}</Link>
            </Button>
          </div>
        ) : null}

        <Button asChild variant="ghost" size="lg" className="w-full">
          <Link to="/dock">{t('loading.released.backToRuns')}</Link>
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-t border-slate-100 pb-2 pt-[9px]">
      <dt className="type-body m-0 text-muted-foreground">{label}</dt>
      <dd className="type-body-strong m-0 text-right text-foreground">{value}</dd>
    </div>
  )
}
