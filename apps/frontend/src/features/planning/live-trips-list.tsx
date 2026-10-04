// Figma: 19 Tracking · 185:17224 and 19a Trip details · 464:1966, the trip list on the left.
import type { TrackingStopDto, TrackingTripDto } from '@compass/api-client'
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { nextLine, TRIP_STANDING, useLiveDay } from './live-day'

/** One dot per stop: filled when delivered, ringed when next, red when late, amber at risk. */
function StopDot({ stop }: { stop: TrackingStopDto }) {
  const base = 'inline-block size-[10px] shrink-0 rounded-full'
  switch (stop.standing) {
    case 'DELIVERED':
    case 'PARTIAL':
      return <span aria-hidden="true" className={cn(base, 'bg-primary')} />
    case 'FAILED':
      return <span aria-hidden="true" className={cn(base, 'bg-destructive-foreground')} />
    case 'NEXT':
      return <span aria-hidden="true" className={cn(base, 'border-2 border-primary bg-background ring-2 ring-primary/20')} />
    case 'LATE':
      return <span aria-hidden="true" className={cn(base, 'border-2 border-destructive-foreground bg-background')} />
    case 'AT_RISK':
      return <span aria-hidden="true" className={cn(base, 'border-2 border-status-warning-fg bg-background')} />
    default:
      return <span aria-hidden="true" className={cn(base, 'border-[1.5px] border-slate-400 bg-background')} />
  }
}

export interface LiveTripsListProps {
  depotId: string
  /** The trip 19a shows; highlighted in the list. */
  selectedId?: string
}

/**
 * The day's trips, late ones first, each with a dot per stop, the next arrival and its window, and
 * how many stops are done. A trip opens 19a.
 */
export function LiveTripsList({ depotId, selectedId }: LiveTripsListProps) {
  const navigate = useNavigate()
  const day = useLiveDay(depotId)
  const board = day.data?.data
  const depotName = DEPOT_NAMES[depotId as keyof typeof DEPOT_NAMES] ?? depotId

  return (
    <section aria-label="Trips on the road" className="flex flex-col rounded-lg border border-border bg-background">
      <header className="border-b border-border px-4 py-3">
        <p className="type-label m-0 uppercase text-muted-foreground">
          {board ? `${board.totals.trips} trips · ${board.totals.onRoad} on the road` : 'Trips'}
        </p>
      </header>
      {day.isError ? (
        <div className="p-3">
          <ErrorState error={day.error} onRetry={() => void day.refetch()} />
        </div>
      ) : !board ? (
        <div className="flex flex-col gap-px">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[98px] rounded-none" />
          ))}
        </div>
      ) : board.trips.length === 0 ? (
        <div className="p-3">
          <EmptyState title="No trips today" description="Once the day's plan is published, its trips show here." />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {board.trips.map((t) => (
            <TripCard key={t.tripId} trip={t} depotName={depotName} selected={t.tripId === selectedId} onOpen={() => void navigate(`/dispatch/trips/${t.tripId}`)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TripCard({ trip: t, depotName, selected, onOpen }: { trip: TrackingTripDto; depotName: string; selected: boolean; onOpen: () => void }) {
  const chip = TRIP_STANDING[t.standing] ?? { label: t.standing, tone: 'neutral' as const }
  return (
    <li>
      <button
        type="button"
        aria-label={`${t.vehicleCode} trip ${t.tripNo ?? 1}`}
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        className={cn(
          'flex w-full flex-col gap-2 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:bg-slate-50',
          selected && 'bg-accent shadow-[inset_3px_0_0_var(--color-primary)]',
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-bold text-foreground">{t.vehicleCode}</span>
            <span className="type-body-small text-muted-foreground">Trip {t.tripNo ?? 1}</span>
          </span>
          <StatusChip tone={chip.tone}>{t.cantRunReason ? "Can't run" : chip.label}</StatusChip>
        </span>
        <span className="flex flex-wrap gap-1.5" aria-label={`${t.delivered} of ${t.stopsTotal} stops done`}>
          {t.stops.map((s) => (
            <StopDot key={s.stopId} stop={s} />
          ))}
        </span>
        <span className="flex items-end justify-between gap-3">
          <span className="type-body-small text-slate-700">{nextLine(t, depotName)}</span>
          <span className="font-mono text-[12px] font-bold text-foreground">
            {t.delivered}/{t.stopsTotal}
          </span>
        </span>
      </button>
    </li>
  )
}
