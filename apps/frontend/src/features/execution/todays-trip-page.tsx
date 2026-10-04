// Figma: D1 Today's trip · 185:19938
import { useMeGet, useMyTripsList, type TripSummaryDto } from '@compass/api-client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { enqueue, useCachedStops, useCachedTrip, type CachedTrip } from '@/offline'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { useServerClock } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { DeliveryWindow } from '@/ui/delivery-window'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { CantRunDialog } from './cant-run-dialog'
import { DownloadFailedCard } from './download-failed-card'
import { cachedTripLinks } from './offline-links'
import { useTripBundle } from './use-trip-bundle'

/** The frame lists four stops and counts the rest. */
const LISTED = 4

/**
 * D1 is the only driver screen that needs the network, and only to learn which trip is hers and to
 * pull it down. Everything it shows comes from Dexie, so a driver who opens it in the yard with no
 * bars still sees the trip she downloaded at the depot (specs/execution/spec.md, AC-EXE-04).
 */
export function TodaysTripPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { now } = useServerClock(30_000)
  const today = toColomboDate(now)

  const [cantRunOpen, setCantRunOpen] = useState(false)
  const me = useMeGet()
  const trips = useMyTripsList({ date: today })
  const summary: TripSummaryDto | undefined = trips.data?.data[0]
  const tripId = summary?.id

  const bundle = useTripBundle(tripId, summary?.version)
  const cached = useCachedTrip(tripId)
  const stops = useCachedStops(tripId)

  if (trips.isPending && !cached) return <TripSkeleton />
  if (trips.isError && !cached)
    return <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
  if (!tripId)
    // D14 No trip (247:924) is its own frame and its own issue. Until that is built this says the
    // same thing in the shell's own words rather than guessing at a design nobody has read.
    return <EmptyState title={t('driver.noTripTitle')} description={t('driver.noTripBody')} />

  // Once the bundle is on the phone the cached status decides, so the screen behaves the same with
  // or without signal; before that the server's own link does.
  const openStops = stops.filter((stop) => stop.status === 'PENDING' || stop.status === 'ARRIVED').length
  const tripLinks = cached ? cachedTripLinks(cached, openStops) : {}
  const startLink = cached ? tripLinks.start : getLink(summary?._links, 'start')
  // A driver who closed the app after her last stop comes back here, so D1 has to offer the way to
  // D7 as well — otherwise a finished round has no ending (AC-EXE-15).
  const completeLink = tripLinks.complete

  const start = async () => {
    await enqueue({ kind: 'driver', type: 'TRIP_STARTED', tripId, baseVersion: cached?.version })
    const first = stops.find((stop) => stop.status === 'PENDING') ?? stops[0]
    if (first) void navigate(`/driver/stops/${first.id}`)
  }

  return (
    <>
      <header className="-mx-4 flex flex-col gap-0.5 border-b border-border px-4 pb-3">
        <h1 className="type-heading m-0 text-foreground">{t('driver.todaysTrip')}</h1>
        <p className="type-body m-0 text-muted-foreground">{me.data?.data.name ?? ''}</p>
      </header>

      {cached ? <TripCard trip={cached} /> : <Skeleton className="h-[200px] w-full rounded-lg" />}

      {bundle.state === 'failed' ? (
        <DownloadFailedCard lastBundleAt={bundle.lastBundleAt} onRetry={bundle.retry} />
      ) : (
        <SavedForOffline saving={bundle.state === 'downloading'} />
      )}

      <section className="flex w-full flex-col">
        <p className="type-label m-0 pb-1 uppercase text-muted-foreground">
          {t('driver.stopsAndWindows')}
        </p>
        {stops.slice(0, LISTED).map((stop, index) => (
          <div key={stop.id} className="flex items-center border-t border-slate-100 pt-[11px] pb-2.5">
            <span className="type-data-bold w-[24.5px] shrink-0 text-muted-foreground">{index + 1}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {cached?.tempClass === 'CHILLED' ? (
                <Icon name="leaf" size={14} className="text-teal-700" />
              ) : null}
              <span className="type-field-label truncate text-foreground">{stop.outletName}</span>
            </span>
            {stop.windowStart && stop.windowEnd ? (
              <DeliveryWindow open={stop.windowStart} close={stop.windowEnd} className="text-slate-700" />
            ) : null}
          </div>
        ))}
        {stops.length > LISTED ? (
          <p className="type-body m-0 pt-1.5 text-muted-foreground">
            {t('driver.moreStops', { count: stops.length - LISTED })}
          </p>
        ) : null}
      </section>

      <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background px-4 pt-[13px] pb-2">
        {completeLink ? (
          <Action
            link={completeLink}
            onAction={() => void navigate(`/driver/trips/${tripId}/done`)}
            variant="primary"
            className="h-[52px] w-full text-[16px]"
          >
            {t('driver.finishTrip')}
          </Action>
        ) : (
          <>
            <Action
              link={startLink}
              onAction={start}
              variant="primary"
              className="h-[52px] w-full text-[16px]"
              // D2: a trip the phone does not fully hold cannot be started, or the driver leaves the
              // depot with half a round on board.
              disabled={bundle.state !== 'saved'}
            >
              {t('driver.startTrip')}
            </Action>
            <p className="type-caption m-0 text-center text-muted-foreground">{t('driver.startNote')}</p>
          </>
        )}
        <Button
          variant="ghost"
          className="h-11 w-full text-[15px] text-slate-700"
          onClick={() => setCantRunOpen(true)}
        >
          {t('driver.cantRunLink')}
        </Button>
      </footer>

      <CantRunDialog
        trip={cached}
        serverLinks={summary?._links}
        open={cantRunOpen}
        onOpenChange={setCantRunOpen}
      />
    </>
  )
}

/** The trip card: who is driving what, and the three facts that decide the morning. */
function TripCard({ trip }: { trip: CachedTrip }) {
  const { t } = useTranslation()
  const rows: readonly { label: string; value: string }[] = [
    {
      label: t('driver.departs'),
      value: trip.departsAt ? `${formatColombo(trip.departsAt, 'HH:mm')} · ${trip.depotId}` : '—',
    },
    { label: t('driver.stops'), value: String(trip.stopCount) },
    { label: t('driver.load'), value: trip.tempClass === 'CHILLED' ? 'Chilled' : 'Ambient' },
  ]

  return (
    <Card className="w-full">
      <CardContent className="flex flex-col gap-0.5 px-4 py-3.5">
        <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.newTripAssigned')}</p>
        <p className="type-heading m-0 pt-1 text-foreground">{trip.tripRef}</p>
        <div className="flex gap-1.5 pt-1.5 pb-1">
          <StatusChip tone="muted">{trip.tempClass === 'CHILLED' ? 'REEFER' : 'AMBIENT'}</StatusChip>
          <span className="type-metadata self-center text-muted-foreground">{trip.vehicleCode}</span>
        </div>
        <dl className="m-0 flex flex-col">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-[9px] pb-2"
            >
              <dt className="type-body m-0 text-muted-foreground">{row.label}</dt>
              <dd className="type-body-strong m-0 text-right text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function SavedForOffline({ saving }: { saving: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-page px-[17px] py-[13px]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="type-body-strong m-0 text-foreground">
          {saving ? t('driver.saving') : t('driver.savedForOffline')}
        </p>
        <p className="type-body m-0 text-slate-700">{t('driver.savedForOfflineBody')}</p>
      </div>
    </div>
  )
}

function TripSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-[200px] w-full rounded-lg" />
      <Skeleton className="h-[68px] w-full rounded-lg" />
      <Skeleton className="h-[180px] w-full" />
    </div>
  )
}
