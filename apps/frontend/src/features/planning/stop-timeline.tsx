// Figma: 19a Trip details · 464:1966, the right column: the trip's load and its stops in order.
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { Link as RouterLink } from 'react-router'
import { cn } from '@/lib/cn'
import { formatColombo } from '@/lib/format-colombo'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { stopSpare, stopTime, STOP_STANDING, TRIP_STANDING, useLiveDay } from './live-day'
import { BRAND_GLYPH, BRAND_WORD, clock, kg } from './plan-copy'

const DOT: Record<string, string> = {
  DELIVERED: 'border-primary bg-primary',
  PARTIAL: 'border-primary bg-primary',
  FAILED: 'border-destructive-foreground bg-destructive-foreground',
  NEXT: 'border-primary bg-background ring-2 ring-primary/20',
  AT_RISK: 'border-status-warning-fg bg-background',
  LATE: 'border-destructive-foreground bg-background',
  PLANNED: 'border-slate-400 bg-background',
}

/**
 * 19a: one trip, stop by stop: planned, projected and actual times, minutes spare against each
 * window, and where it stands. The projection comes from the server's engine (GET /depots/{id}/tracking).
 */
export function StopTimeline({ depotId, tripId }: { depotId: string; tripId: string }) {
  const day = useLiveDay(depotId)
  const trip = day.data?.data.trips.find((t) => t.tripId === tripId)
  const depotName = DEPOT_NAMES[depotId as keyof typeof DEPOT_NAMES] ?? depotId

  if (day.isError) return <ErrorState error={day.error} onRetry={() => void day.refetch()} />
  if (!day.data) return <Skeleton className="h-[560px] w-full rounded-lg" />
  if (!trip)
    return (
      <section className="rounded-lg border border-border bg-background p-4">
        <p className="type-body m-0 text-muted-foreground">This trip is not on today's board at {depotName}.</p>
      </section>
    )

  const chip = TRIP_STANDING[trip.standing] ?? { label: trip.standing, tone: 'neutral' as const }
  const glyph = BRAND_GLYPH[trip.brand]
  const firstWindow = trip.stops.length ? Math.min(...trip.stops.map((s) => s.windowOpenMin)) : null

  return (
    <section aria-label={`${trip.vehicleCode} trip ${trip.tripNo ?? 1} stops`} className="flex flex-col rounded-lg border border-border bg-background">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <RouterLink to="/dispatch/tracking" aria-label="All runs" className="flex size-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-slate-100">
          <Icon name="back" size={16} />
        </RouterLink>
        <div className="flex flex-1 flex-col">
          <span className="font-mono text-[14px] font-bold text-foreground">
            {trip.vehicleCode} · Trip {trip.tripNo ?? 1}
          </span>
          <span className="type-body-small text-muted-foreground">
            {trip.driverName ?? 'No driver'} · {trip.status === 'IN_PROGRESS' ? 'en route' : trip.status.toLowerCase().replace('_', ' ')}
          </span>
        </div>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </header>

      <div className="border-b border-border px-4 py-3">
        <p className="type-label m-0 uppercase text-muted-foreground">Trip load</p>
        <p className="type-body m-0 text-foreground">
          {trip.stopsTotal} stops · {BRAND_WORD[trip.brand] ?? trip.brand} · {trip.tempClass === 'CHILLED' ? 'Chilled' : 'Dry'} · {kg(trip.loadWeightKg)} ·{' '}
          {trip.loadVolumeM3.toFixed(1)} m³{firstWindow !== null ? ` · first window ${clock(firstWindow)}` : ''}
        </p>
      </div>

      <ol className="m-0 flex list-none flex-col px-4 py-2">
        <li className="flex items-center gap-3 py-2">
          <span aria-hidden="true" className="size-3.5 rounded-full border-[3px] border-primary bg-background" />
          <span className="type-body-medium flex-1 font-bold text-foreground">{depotName} depot</span>
          <span className="font-mono text-[11px] uppercase text-muted-foreground">
            {trip.plannedDepartAt ? `${trip.status === 'IN_PROGRESS' || trip.status === 'COMPLETED' ? 'Departed' : 'Departs'} ${formatColombo(trip.plannedDepartAt, 'HH:mm')}` : ''}
          </span>
        </li>
        {trip.stops.map((s) => {
          const st = STOP_STANDING[s.standing] ?? { label: s.standing, tone: 'neutral' as const }
          return (
            <li key={s.stopId} aria-label={s.outletName} className="flex gap-3 border-t border-slate-100 py-2.5">
              <span aria-hidden="true" className={cn('mt-1 size-3.5 shrink-0 rounded-full border-[3px]', DOT[s.standing] ?? DOT.PLANNED)} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="type-body-medium flex items-center gap-2 font-bold text-foreground">
                    {glyph ? <Icon name={glyph.icon} size={14} className={glyph.className} /> : null}
                    {s.outletName}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-foreground">{stopTime(s)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{s.orderNo}</span>
                  <span className="flex items-center gap-2">
                    <span className={cn('font-mono text-[11px] uppercase', s.standing === 'LATE' ? 'text-destructive-foreground' : 'text-muted-foreground')}>
                      {stopSpare(s)}
                    </span>
                    <StatusChip tone={st.tone}>{st.label}</StatusChip>
                  </span>
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
