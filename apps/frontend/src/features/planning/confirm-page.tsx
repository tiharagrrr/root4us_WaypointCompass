// Figma: 14 Confirm trips · 185:15323, step 2 of planning.
import type { PlanVehicleOptionDto, TripDto } from '@compass/api-client'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { usePageHeader } from '@/app/layouts/header-slot'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { NotPlannedCard } from './not-planned-card'
import { DayStrip, PlanStepper } from './plan-chrome'
import { BRAND_WORD, CHECKS, dayLabel, kg, percent, vehicleKind } from './plan-copy'
import { Bar } from './plan-panels'
import { usePlanStep } from './use-plan-step'

const hard = (t: TripDto) => t.violations.filter((v) => v.severity === 'HARD')
const CAPACITY = new Set(['CAP_WEIGHT', 'CAP_VOLUME'])

/** "1 order doesn’t fit", "6 orders don’t fit". */
const dontFit = (n: number) => (n === 1 ? '1 order doesn’t fit' : `${n} orders don’t fit`)

/**
 * 14: every trip with its loads and time, the orders no trip took, and the six feasibility checks.
 * Confirming moves on to step 3, where each order left over gets its decision; a trip that breaks a
 * check has to be fixed on step 1 first (the checks are the API's own violations on each trip).
 */
export function ConfirmPage() {
  const step = usePlanStep()
  const navigate = useNavigate()
  const { date, day, plan, trips, unplanned } = step
  const [filter, setFilter] = useState<'all' | 'over'>('all')
  usePageHeader({
    eyebrow: `PLAN · ${dayLabel(date).toUpperCase()} · ${plan?.status ?? ''}`,
    title: `Plan · ${step.dayWord}`,
  })

  const vehicles = day.vehicles.data?.data ?? []
  const failing = new Set<string>(trips.flatMap((t) => hard(t).map((v) => v.rule)))
  const over = trips.filter((t) => hard(t).some((v) => CAPACITY.has(v.rule)))
  const shown = filter === 'all' ? trips : over
  const byVehicle = new Map<string, TripDto[]>()
  for (const trip of shown) byVehicle.set(trip.vehicleId, [...(byVehicle.get(trip.vehicleId) ?? []), trip])
  const passes = failing.size === 0

  return (
    <div className="-mx-6 -mb-4 -mt-4 flex min-h-0 flex-1 flex-col">
      <DayStrip date={date} tomorrow={step.tomorrow} now={step.now} status={plan?.status ?? ''} />
      <PlanStepper step={2} unplanned={unplanned.length} />

      <div className="flex min-h-0 flex-1 items-stretch gap-4 bg-page px-6 py-4">
        {day.plan.isError ? (
          <ErrorState className="flex-1" error={day.plan.error} onRetry={() => void day.plan.refetch()} />
        ) : !plan || day.isPending ? (
          <>
            <Skeleton className="h-[640px] w-[260px]" />
            <Skeleton className="h-[640px] min-w-px flex-1" />
            <Skeleton className="h-[400px] w-[260px]" />
          </>
        ) : (
          <>
            <NotPlannedCard
              orders={unplanned}
              input={day.engine?.input}
              withReasons
              heading={{ title: 'Unplanned', caption: `These don’t fit any trip ${step.dayWord === 'Tomorrow' ? 'tomorrow' : `on ${step.dayWord}`}.` }}
            />

            <div className="flex min-w-px flex-1 flex-col gap-3 self-start">
              <SegmentedControl<'all' | 'over'>
                aria-label="Show"
                value={filter}
                onValueChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'over', label: 'Exceeded capacity', count: over.length },
                ]}
              />
              {[...byVehicle.entries()].map(([vehicleId, own]) => (
                <VehicleTrips
                  key={vehicleId}
                  trips={own}
                  vehicle={vehicles.find((v) => v.vehicleId === vehicleId)}
                  onAddTrip={own.length < 2 ? () => void navigate(`/dispatch/plan/${date}`) : undefined}
                />
              ))}
            </div>

            <div className="flex w-[260px] shrink-0 flex-col gap-4 self-start">
              <section aria-label="Feasibility check" className="rounded-lg border border-border bg-background">
                <h2 className="type-card-title m-0 border-b border-border px-4 py-3 text-foreground">Feasibility check</h2>
                <ul className="m-0 flex list-none flex-col gap-3 p-4">
                  {CHECKS.map((check) => {
                    const ok = !check.rules.some((rule) => failing.has(rule))
                    return (
                      <li key={check.label} aria-label={`${check.label}: ${ok ? 'passes' : 'fails'}`} className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-[18px] items-center justify-center rounded-full text-primary-foreground',
                            ok ? 'bg-default' : 'bg-status-danger-icon',
                          )}
                        >
                          <Icon name={ok ? 'check' : 'close'} size={12} />
                        </span>
                        <span className={cn('type-body', ok ? 'text-foreground' : 'text-status-danger-fg')}>{check.label}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section aria-label="Confirm" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
                <h2 className="type-card-title m-0 text-foreground">{dontFit(unplanned.length)}</h2>
                <p className="type-body m-0 text-muted-foreground">
                  {passes
                    ? `Confirming keeps these ${trips.length} trips and moves the ${unplanned.length} left over to step 3, where you decide what to defer and why.`
                    : 'A trip breaks a check. Fix it on the plan before you confirm.'}
                </p>
                <Button variant="primary" disabled={!passes} onClick={() => void navigate(`/dispatch/plan/${date}/unplanned`)}>
                  Confirm trips
                </Button>
                {passes ? null : (
                  <Button variant="outline" onClick={() => void navigate(`/dispatch/plan/${date}`)}>
                    Back to plan
                  </Button>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface VehicleTripsProps {
  trips: readonly TripDto[]
  vehicle: PlanVehicleOptionDto | undefined
  onAddTrip?: () => void
}

/** One vehicle: its time against the budget, then each trip's load against the vehicle. */
function VehicleTrips({ trips, vehicle, onAddTrip }: VehicleTripsProps) {
  const first = trips[0]
  if (!first) return null
  const minutes = trips.reduce((n, t) => n + t.minutes, 0)
  const budget = first.budgetMinutes
  const fresh = first.brand === 'FRESH'
  return (
    <section aria-label={first.vehicleCode} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <header className="flex items-center gap-2.5 whitespace-nowrap">
        <span className="font-mono text-[13px] font-bold text-foreground">{first.vehicleCode}</span>
        <span className="type-body-small text-slate-700">{vehicleKind(vehicle?.type ?? 'TRUCK', vehicle?.temp ?? 'AMBIENT')}</span>
        <span className="type-mono-small text-muted-foreground">
          {kg(first.weightCapKg)} · {first.volumeCapM3} m³
        </span>
        <span className="flex-1" />
        <span className="type-label uppercase text-muted-foreground">{fresh ? 'Chilled time limit' : 'Shift time'}</span>
        <span className="font-mono text-[12px] font-bold text-foreground">
          {Math.round(minutes)} / {budget} min
        </span>
        <Bar value={percent(minutes, budget)} tone={minutes > budget ? 'danger' : 'primary'} className="h-1.5 w-[72px]" />
      </header>
      <div className="grid grid-cols-2 gap-3">
        {trips.map((trip) => (
          <TripLoad key={trip.id} trip={trip} />
        ))}
        {onAddTrip && trips.length < 2 ? (
          <button
            type="button"
            onClick={onAddTrip}
            className="type-body-medium flex min-h-[120px] cursor-pointer items-center justify-center rounded-md border border-dashed border-slate-300 bg-transparent text-primary hover:bg-slate-50"
          >
            + Add trip 2
          </button>
        ) : null}
      </div>
    </section>
  )
}

function TripLoad({ trip }: { trip: TripDto }) {
  const weight = percent(trip.loadWeightKg, trip.weightCapKg)
  const volume = percent(trip.loadVolumeM3, trip.volumeCapM3)
  return (
    <article className="flex flex-col gap-2 rounded-md border border-slate-200 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="type-body-medium m-0 font-bold text-foreground">
          Trip {trip.tripNo} · {BRAND_WORD[trip.brand] ?? trip.brand} · {trip.districtName}
        </p>
        <p className="type-mono-small m-0 shrink-0 text-muted-foreground">
          {trip.stops.length} stops · {Math.round(trip.plannedKm)} km
        </p>
      </div>
      <Load label="Weight" value={`${kg(trip.loadWeightKg).replace(' kg', '')} / ${kg(trip.weightCapKg)} · ${weight}%`} pct={weight} />
      <Load label="Volume" value={`${trip.loadVolumeM3.toFixed(1)} / ${trip.volumeCapM3.toFixed(1)} m³ · ${volume}%`} pct={volume} />
    </article>
  )
}

function Load({ label, value, pct }: { label: string; value: string; pct: number }) {
  const over = pct > 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="type-label uppercase text-muted-foreground">{label}</span>
        <span className={cn('font-mono text-[12px] font-bold', over ? 'text-status-danger-fg' : 'text-foreground')}>{value}</span>
      </div>
      <Bar value={pct} tone={over ? 'danger' : 'primary'} className="h-1.5 w-full" />
    </div>
  )
}
