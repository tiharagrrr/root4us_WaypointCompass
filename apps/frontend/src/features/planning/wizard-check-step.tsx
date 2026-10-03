// Figma: 08 Add vehicle · Check · 267:2216 (body 267:2333)
import type { PlanVehicleOptionDto, ViolationDto } from '@compass/api-client'
import type { ScheduledTrip } from '@waypoint/engine'
import { cn } from '@/lib/cn'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { BRAND_WORD, CHECKS, clock, kg, percent } from './plan-copy'

export interface CheckStepProps {
  vehicle: PlanVehicleOptionDto
  tripNo: number
  trip: ScheduledTrip | undefined
  districtName: string
  depotName: string
  stopNames: readonly string[]
  /** What the server's validate says the trip's edits would break; undefined while it runs. */
  introduced: readonly ViolationDto[] | undefined
}

/** 08: the server checks the trip before it is saved (AC-PLN-12), rule group by rule group. */
export function CheckStep({ vehicle, tripNo, trip, districtName, depotName, stopNames, introduced }: CheckStepProps) {
  const hard = (introduced ?? []).filter((v) => v.severity === 'HARD')
  const soft = (introduced ?? []).filter((v) => v.severity === 'SOFT')
  const passes = introduced !== undefined && hard.length === 0
  const weightPct = percent(trip?.weightKg ?? 0, vehicle.weightCapKg)
  const volumePct = percent(trip?.volumeM3 ?? 0, vehicle.volumeCapM3)

  return (
    <div className="flex flex-col gap-4 px-5 py-3.5">
      <div className="flex items-center justify-between">
        <p className="type-section m-0 text-foreground">
          {vehicle.code} · Trip {tripNo}
          {trip ? ` · ${BRAND_WORD[trip.brand]} · ${districtName}` : ''}
        </p>
        {introduced === undefined ? null : (
          <StatusChip tone={passes ? 'neutral' : 'danger'}>
            {passes ? (soft.length ? `Checks pass · ${soft.length} warning` : 'Checks pass') : `${hard.length} checks fail`}
          </StatusChip>
        )}
      </div>
      <div className="flex items-start gap-4">
        <section className="flex min-w-px flex-1 flex-col self-stretch rounded-lg border border-border bg-background p-px shadow-sm">
          <h4 className="type-card-title m-0 border-b border-border px-4 pb-[13px] pt-3 text-foreground">Feasibility check</h4>
          <ul className="m-0 flex list-none flex-col px-4 pb-2.5 pt-1.5">
            {CHECKS.map((check) => {
              const broken = hard.filter((v) => check.rules.includes(v.rule))
              const ok = broken.length === 0
              return (
                <li key={check.label} className="flex flex-col gap-0.5 py-1.5">
                  <span className="flex items-center gap-2.5">
                    {introduced === undefined ? (
                      <Skeleton className="size-[18px] rounded-full" />
                    ) : (
                      <span
                        className={cn(
                          'flex size-[18px] items-center justify-center rounded-full text-white',
                          ok ? 'bg-slate-900' : 'bg-destructive-foreground',
                        )}
                      >
                        <Icon name={ok ? 'check' : 'close'} size={12} />
                      </span>
                    )}
                    <span className="type-body-small text-foreground">{check.label}</span>
                  </span>
                  {broken.map((v) => (
                    <span key={`${v.rule}${v.tripKey ?? ''}${v.orderId ?? ''}`} className="type-caption pl-7 text-destructive-foreground">
                      {v.message}
                    </span>
                  ))}
                </li>
              )
            })}
          </ul>
        </section>
        <dl className="m-0 flex min-w-px flex-1 flex-col rounded-lg border border-border bg-background px-4 py-3">
          <Row label="Stops" value={`${stopNames.length} · ${stopNames.join(', ')}`} first />
          <Row label="Weight" value={`${kg(trip?.weightKg ?? 0).replace(' kg', '')} / ${kg(vehicle.weightCapKg)} · ${weightPct}%`} />
          <Row label="Volume" value={`${(trip?.volumeM3 ?? 0).toFixed(1)} / ${vehicle.volumeCapM3.toFixed(1)} m³ · ${volumePct}%`} />
          <Row label="Route time" value={`${Math.round(trip?.minutes ?? 0)} min`} />
          <Row label="Departs" value={`${trip ? clock(trip.departMin) : '—'} · ${depotName}`} />
        </dl>
      </div>
    </div>
  )
}

function Row({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 pb-2 pt-[9px]', first ? '' : 'border-t border-slate-100')}>
      <dt className="type-body-small text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-right font-sans text-[13px] font-bold text-foreground">{value}</dd>
    </div>
  )
}
