// Figma: D7 Trip complete · 185:20391
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useParams } from 'react-router'
import { enqueue, useCachedStops, useCachedTrip, type CachedStop } from '@/offline'
import { formatColombo } from '@/lib/format-colombo'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { cachedTripLinks } from './offline-links'

/** A stop still waiting for a result. The trip cannot end while one exists (AC-EXE-15). */
const isOpen = (stop: CachedStop): boolean => stop.status === 'PENDING' || stop.status === 'ARRIVED'

/**
 * D7, the end of the round: what the driver actually delivered, and the one button that closes the
 * trip. Like every driver screen it reads from Dexie and writes through the outbox, so a driver
 * finishing in a yard with no bars sees the same summary and keeps the same queued event
 * (architecture rule 10).
 *
 * `TRIP_COMPLETED` needs every stop to carry a result, so when one is still open this shows what is
 * left instead of a button that would be refused — the same rule the server applies, read from the
 * trip machine in `cachedTripLinks`.
 */
export function TripCompletePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const trip = useCachedTrip(id)
  const stops = useCachedStops(id)

  if (!trip) return <CompleteSkeleton />

  const open = stops.filter(isOpen)
  const counts = {
    delivered: stops.filter((stop) => stop.status === 'DELIVERED').length,
    partial: stops.filter((stop) => stop.status === 'PARTIAL').length,
    failed: stops.filter((stop) => stop.status === 'FAILED').length,
  }
  const links = cachedTripLinks(trip, open.length)
  const done = trip.status === 'COMPLETED'

  const finish = async () => {
    await enqueue({ kind: 'driver', type: 'TRIP_COMPLETED', tripId: trip.id, baseVersion: trip.version })
  }

  // A trip the phone holds but that has not run: nothing to summarise, so say so rather than
  // showing a run of zeros.
  if (!done && trip.status !== 'IN_PROGRESS')
    return (
      <EmptyState
        title={t('driver.otherTripTitle')}
        description={t('driver.otherTripBody')}
        action={
          <Button asChild variant="outline">
            <RouterLink to="/driver">{t('driver.backToTrip')}</RouterLink>
          </Button>
        }
      />
    )

  return (
    <>
      <header className="-mx-4 flex flex-col gap-0.5 border-b border-border px-4 pb-3">
        <h1 className="type-heading m-0 text-foreground">
          {done ? t('driver.tripFinishedTitle') : t('driver.tripCompleteTitle')}
        </h1>
        <p className="type-body m-0 text-muted-foreground">{trip.tripRef}</p>
      </header>

      <Card className="w-full">
        <CardContent className="flex flex-col gap-0.5 px-4 py-3.5">
          <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.runSummary')}</p>
          <div className="flex gap-1.5 pt-1.5 pb-1">
            <StatusChip tone={done ? 'success' : 'muted'}>{trip.status}</StatusChip>
            <span className="type-metadata self-center text-muted-foreground">{trip.vehicleCode}</span>
          </div>
          <dl className="m-0 flex flex-col">
            <SummaryRow label={t('driver.stops')} value={String(stops.length)} />
            <SummaryRow label={t('driver.delivered')} value={String(counts.delivered)} />
            {counts.partial > 0 ? <SummaryRow label={t('driver.partial')} value={String(counts.partial)} /> : null}
            {counts.failed > 0 ? <SummaryRow label={t('driver.failed')} value={String(counts.failed)} /> : null}
            <SummaryRow
              label={t('driver.startedAt')}
              value={trip.departsAt ? formatColombo(trip.departsAt, 'HH:mm') : '—'}
            />
          </dl>
        </CardContent>
      </Card>

      {open.length > 0 ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-status-warning-border bg-page px-[17px] py-[13px]">
          <p className="type-body-strong m-0 text-foreground">
            {t('driver.stopsOpenTitle')} · {open.length}
          </p>
          <p className="type-body m-0 text-slate-700">{t('driver.stopsOpenBody')}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {open.map((stop) => (
              <li key={stop.id} className="type-body text-slate-700">
                {stop.sequence}. {stop.outletName}
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="h-11 w-full">
            <RouterLink to={`/driver/stops/${open[0]!.id}`}>{t('driver.goToNextStop')}</RouterLink>
          </Button>
        </div>
      ) : null}

      {done ? (
        <div className="flex w-full flex-col gap-1 rounded-lg border border-status-success-border bg-page px-[17px] py-[13px]">
          <p className="type-body-strong m-0 text-foreground">{t('driver.tripFinishedTitle')}</p>
          <p className="type-body m-0 text-slate-700">{t('driver.tripFinishedBody')}</p>
        </div>
      ) : null}

      <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background px-4 pt-[13px] pb-2">
        {done ? (
          <Button
            variant="primary"
            className="h-[52px] w-full text-[16px]"
            onClick={() => void navigate('/driver')}
          >
            {t('driver.backToToday')}
          </Button>
        ) : (
          <>
            <Action
              link={links.complete}
              onAction={finish}
              variant="primary"
              className="h-[52px] w-full text-[16px]"
            >
              {t('driver.finishTrip')}
            </Action>
            <p className="type-caption m-0 text-center text-muted-foreground">{t('driver.finishNote')}</p>
          </>
        )}
      </footer>
    </>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-[9px] pb-2">
      <dt className="type-body m-0 text-muted-foreground">{label}</dt>
      <dd className="type-body-strong m-0 text-right text-foreground">{value}</dd>
    </div>
  )
}

function CompleteSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-[220px] w-full rounded-lg" />
      <Skeleton className="h-[52px] w-full rounded-lg" />
    </div>
  )
}
