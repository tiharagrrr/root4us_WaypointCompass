// Figma: 01 Dashboard · 488:8577, the KPI row and Today's runs.
import type { TrackingTripDto } from '@compass/api-client'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { formatColombo } from '@/lib/format-colombo'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { TRIP_STANDING, useLiveDay } from './live-day'
import { vehicleKind } from './plan-copy'

function Kpi({ label, value, caption, danger }: { label: string; value: number | undefined; caption: string; danger?: boolean }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
      <span className="type-label uppercase text-muted-foreground">{label}</span>
      {value === undefined ? (
        <Skeleton className="h-[34px] w-12" />
      ) : (
        <span className={cn('font-sans text-[28px] font-bold leading-tight', danger && value > 0 ? 'text-destructive-foreground' : 'text-foreground')}>{value}</span>
      )}
      <span className="type-body-small text-muted-foreground">{caption}</span>
    </section>
  )
}

/** 01's KPI row: trips on the road, stops delivered, late risk and deferred today. */
export function KpiRow({ depotId }: { depotId: string }) {
  const day = useLiveDay(depotId)
  if (day.isError) return <ErrorState error={day.error} onRetry={() => void day.refetch()} />
  const t = day.data?.data.totals
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Kpi label="Trips on the road" value={t?.onRoad} caption={t ? `of ${t.released} released` : 'released'} />
      <Kpi label="Stops delivered" value={t?.stopsDelivered} caption={t ? `of ${t.stopsPlanned} planned today` : 'planned today'} />
      <Kpi label="Late risk" value={t?.lateRisk} caption="stops past window" danger />
      <Kpi label="Deferred today" value={t?.deferred} caption={t ? `${t.repeatSkips} repeat skip${t.repeatSkips === 1 ? '' : 's'}` : 'repeat skips'} />
    </div>
  )
}

const exception = (t: TrackingTripDto) => t.standing === 'LATE_RISK' || t.cantRunReason !== null

/** "07:42", "dep 07:40", "–": Today's runs' Next ETA column. */
function nextEta(t: TrackingTripDto): string {
  if (t.status === 'COMPLETED') return '–'
  if (t.status === 'IN_PROGRESS' || t.status === 'RELEASED') return t.nextEtaAt ? formatColombo(t.nextEtaAt, 'HH:mm') : '–'
  return t.plannedDepartAt ? `dep ${formatColombo(t.plannedDepartAt, 'HH:mm')}` : '–'
}

/** 01's Today's runs: every trip with its progress, next arrival and standing; a row opens 19a. */
export function TodaysRuns({ depotId, depotName }: { depotId: string; depotName: string }) {
  const navigate = useNavigate()
  const day = useLiveDay(depotId)
  const [show, setShow] = useState<'all' | 'exceptions'>('all')
  const trips = day.data?.data.trips ?? []
  const shown = show === 'all' ? trips : trips.filter(exception)

  return (
    <section aria-label="Today's runs" className="flex flex-col rounded-lg border border-border bg-background">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex flex-col">
          <h2 className="type-card-title m-0 text-foreground">Today’s runs</h2>
          <p className="type-body-small m-0 text-muted-foreground">{depotName}</p>
        </div>
        <SegmentedControl
          aria-label="Show"
          value={show}
          onValueChange={setShow}
          options={[
            { value: 'all', label: 'All', count: trips.length },
            { value: 'exceptions', label: 'Exceptions', count: trips.filter(exception).length },
          ]}
        />
      </header>
      {day.isError ? (
        <div className="p-3">
          <ErrorState error={day.error} onRetry={() => void day.refetch()} />
        </div>
      ) : !day.data ? (
        <Skeleton className="m-3 h-[300px]" />
      ) : shown.length === 0 ? (
        <div className="p-3">
          <EmptyState
            title={show === 'all' ? 'No trips today' : 'No exceptions'}
            description={show === 'all' ? 'Once the day’s plan is published, its trips show here.' : 'Every run is inside its windows.'}
          />
        </div>
      ) : (
        <TableContainer className="rounded-none border-x-0 border-b-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead>Trip</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Stops</TableHead>
                <TableHead>Next ETA</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((t) => {
                const chip = TRIP_STANDING[t.standing] ?? { label: t.standing, tone: 'neutral' as const }
                const pct = t.stopsTotal ? Math.round((t.delivered / t.stopsTotal) * 100) : 0
                return (
                  <TableRow key={t.tripId} className="h-[49px] cursor-pointer" onClick={() => void navigate(`/dispatch/trips/${t.tripId}`)}>
                    <TableCell>
                      <span className="font-mono text-[12px] font-bold">{t.vehicleCode}</span>{' '}
                      <span className="type-body-small text-muted-foreground">{vehicleKind(t.vehicleType, t.vehicleTemp)}</span>
                    </TableCell>
                    <TableCell className="font-mono text-[12px]">Trip {t.tripNo ?? 1}</TableCell>
                    <TableCell className="type-body">{t.driverName ?? '—'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <span aria-hidden="true" className="h-1.5 w-[110px] overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="font-mono text-[12px] font-bold">
                          {t.delivered}/{t.stopsTotal}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className={cn('font-mono text-[12px]', t.standing === 'LATE_RISK' && 'font-bold text-destructive-foreground')}>{nextEta(t)}</TableCell>
                    <TableCell>
                      <StatusChip tone={chip.tone}>{t.cantRunReason ? "Can't run" : chip.label}</StatusChip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </section>
  )
}
