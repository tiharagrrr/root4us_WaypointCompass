// Figma: D3 Next stop · 185:20107
import { useStopsGet } from '@compass/api-client'
import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, Link as RouterLink } from 'react-router'
import { db, enqueue, useCachedStops, useCachedTrip } from '@/offline'
import { formatColombo } from '@/lib/format-colombo'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { DeliveryWindow } from '@/ui/delivery-window'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { devicePosition } from './device-position'
import { DockAccessSheet } from './dock-access-sheet'
import { cachedStopLinks } from './offline-links'

/** The frame shows the two stops after this one. */
const THEN = 2

/**
 * D3 is the screen a driver looks at while she is driving, so it reads only from Dexie: the stop,
 * its window, the dock notes and what comes after it are all already on the phone. Arriving queues
 * ARRIVED with the time and the position and moves her straight to D4 (AC-EXE-08).
 */
export function NextStopPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const [dockOpen, setDockOpen] = useState(false)

  // `null` is a stop this phone does not hold; `undefined` is Dexie still looking.
  const stop = useLiveQuery(async () => (await db.stops.get(id)) ?? null, [id], undefined)
  const trip = useCachedTrip(stop?.tripId)
  const siblings = useCachedStops(stop?.tripId)
  // Online, the server adds the planned arrival this phone's bundle does not carry. Offline the row
  // simply has no value, which is the honest answer at the wheel.
  const live = useStopsGet(id, { query: { enabled: Boolean(id), retry: false } })

  if (stop === undefined) return <StopSkeleton />

  // A stop the phone does not hold, or one whose trip is not the one she is running: never record
  // against it (AC-EXE-02). The driver is told plainly and sent back to her own trip.
  if (!stop || !trip || trip.status !== 'IN_PROGRESS')
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

  const index = siblings.findIndex((s) => s.id === stop.id)
  const openAhead = siblings.some((s) => s.status === 'PENDING' && s.sequence < stop.sequence)
  const then = siblings.filter((s) => s.sequence > stop.sequence && s.status === 'PENDING').slice(0, THEN)
  const links = cachedStopLinks(stop, trip.status)
  const plannedArrival = live.data?.data.plannedArrivalAt

  const arrive = async () => {
    const position = await devicePosition()
    await enqueue({
      kind: 'driver',
      type: 'ARRIVED',
      tripId: stop.tripId,
      stopId: stop.id,
      baseVersion: stop.version,
      ...(position ?? {}),
    })
    void navigate(`/driver/stops/${stop.id}/record`)
  }

  return (
    <>
      <header className="-mx-4 flex items-center gap-2.5 border-b border-border px-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="type-heading m-0 text-foreground">
            {t('driver.stopOf', { n: index + 1, total: siblings.length })}
          </h1>
          <p className="type-body m-0 text-muted-foreground">{trip.tripRef}</p>
        </div>
        <StatusChip tone="muted">{t('driver.sharingLocation')}</StatusChip>
      </header>

      <RouteMap label={`${index + 1} · ${stop.outletName}`} />

      <Card className="w-full">
        <CardContent className="flex flex-col gap-0.5 px-4 py-3.5">
          <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.nextStop')}</p>
          <span className="flex items-center gap-1.5 pt-1">
            {trip.tempClass === 'CHILLED' ? <Icon name="leaf" size={14} className="text-teal-700" /> : null}
            <span className="type-heading text-foreground">{stop.outletName}</span>
          </span>
          {openAhead ? (
            <p className="type-caption m-0 pt-0.5 text-status-at-risk-fg">{t('driver.outOfSequence')}</p>
          ) : null}
          <dl className="m-0 flex flex-col pt-1">
            <Row label={t('driver.eta')}>
              {plannedArrival ? (
                <span className="type-data-bold">{formatColombo(plannedArrival, 'HH:mm')}</span>
              ) : (
                '—'
              )}
            </Row>
            <Row label={t('driver.window')}>
              {stop.windowStart && stop.windowEnd ? (
                <DeliveryWindow open={stop.windowStart} close={stop.windowEnd} strong />
              ) : (
                '—'
              )}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <button
        type="button"
        onClick={() => setDockOpen(true)}
        className="flex min-h-(--compass-size-touch-target) w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-background px-[15px] py-[13px] text-left outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="type-field-label text-foreground">{t('driver.dockAndAccess')}</span>
        <Icon name="chevron-down" size={18} className="-rotate-90 text-slate-700" />
      </button>
      <DockAccessSheet stop={stop} seq={index + 1} open={dockOpen} onOpenChange={setDockOpen} />

      <section className="flex w-full flex-col">
        <p className="type-label m-0 pb-1 uppercase text-muted-foreground">{t('driver.then')}</p>
        {then.map((next) => (
          <div
            key={next.id}
            className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2.5 pb-[9px]"
          >
            <span className="type-field-label truncate text-slate-700">
              {siblings.findIndex((s) => s.id === next.id) + 1} · {next.outletName}
            </span>
            {next.windowStart && next.windowEnd ? (
              <DeliveryWindow open={next.windowStart} close={next.windowEnd} className="text-slate-700" />
            ) : null}
          </div>
        ))}
      </section>

      <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background px-4 pt-[13px] pb-2">
        <div className="flex gap-2">
{stop.lat === null || stop.lng === null ? (
            <Button variant="outline" className="h-[52px] flex-1 text-[16px]" disabled>
              {t('driver.navigate')}
            </Button>
          ) : (
            <Button asChild variant="outline" className="h-[52px] flex-1 text-[16px]">
              <a href={mapsHref(stop.lat, stop.lng)} target="_blank" rel="noreferrer">
                {t('driver.navigate')}
              </a>
            </Button>
          )}
          <Action link={links.arrive} onAction={arrive} variant="primary" className="h-[52px] flex-1 text-[16px]">
            {t('driver.arrived')}
          </Action>
        </div>
        <p className="type-caption m-0 text-center text-muted-foreground">{t('driver.arrivedNote')}</p>
      </footer>
    </>
  )
}

/** Hands the stop to whatever maps app the phone has; the driver navigates there, not here. */
const mapsHref = (lat: number, lng: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-[9px] pb-2">
      <dt className="type-body m-0 text-muted-foreground">{label}</dt>
      <dd className="type-body-strong m-0 text-right text-foreground">{children}</dd>
    </div>
  )
}

/**
 * The frame draws the route map as a flat panel with the driver and the stop pinned on it. There
 * are no map tiles in the app yet (no tile provider is in scope for ROO-32), so this keeps the
 * panel, its label and the stop's pin, and leaves the tiles to the map work itself.
 */
function RouteMap({ label }: { label: string }) {
  const { t } = useTranslation()
  return (
    <div className="relative -mx-4 h-[200px] shrink-0 overflow-clip bg-slate-100">
      <div className="absolute left-3 top-3">
        <StatusChip tone="muted">{t('driver.routeMap')}</StatusChip>
      </div>
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[3px]">
        <span className="size-5 rounded-full border-[3px] border-white bg-default outline outline-default" />
        <span className="type-mono-small rounded-[3px] border border-slate-200 bg-background px-1.5 py-0.5 text-foreground">
          {label}
        </span>
      </div>
    </div>
  )
}

function StopSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-[200px] w-full" />
      <Skeleton className="h-[160px] w-full rounded-lg" />
    </div>
  )
}
