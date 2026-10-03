// Figma: 05 Plan · empty · 265:2134 ("Panel / No vehicles yet", 271:4603) and 09 Plan · vehicles ·
// 268:2245 ("Card / Plan progress" 268:2364, "Card / REF-07" 268:2374, "Card / Add vehicle" 268:2495).
import type { PlanDto, PlanVehicleOptionDto, TripDto } from '@compass/api-client'
import type { ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { StatusChip } from '@/ui/status-chip'
import { BRAND_WORD, kg, percent, vehicleKind } from './plan-copy'

export interface EmptyPanelProps {
  orders: number
  vehicles: readonly PlanVehicleOptionDto[]
  dayWord: string
  /** The Add Trip and Auto-suggest actions; each renders only with its link. */
  actions: ReactNode
}

/** 05: no vehicle in the plan yet, and the two ways to start. */
export function EmptyPanel({ orders, vehicles, dayWord, actions }: EmptyPanelProps) {
  const free = vehicles.filter((v) => v.available && v.tripsLeft > 0).length
  const workshop = vehicles.filter((v) => v.unavailableReason === 'WORKSHOP').length
  return (
    <div className="flex min-w-px flex-1 items-center justify-center">
      <section className="flex w-[560px] flex-col gap-6 rounded-lg border border-border bg-background p-8">
        <div className="flex flex-col gap-2">
          <h2 className="type-heading m-0 text-foreground">No vehicles in {dayWord}’s plan yet</h2>
          <p className="type-body m-0 text-muted-foreground">
            Add one vehicle at a time and give it orders. Repeat until {dayWord}’s orders are covered.
          </p>
        </div>
        <ol className="m-0 flex list-none items-center gap-3 rounded-md border border-slate-200 bg-page px-4 py-3">
          {['Pick a vehicle', 'Add its orders', 'Check and save'].map((label, i) => (
            <li key={label} className="contents">
              {i > 0 ? <span aria-hidden="true" className="h-px min-w-px flex-1 bg-slate-300" /> : null}
              <span className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full border border-slate-300 bg-background font-mono text-[13px] font-bold">
                  {i + 1}
                </span>
                <span className="type-body-medium whitespace-nowrap text-foreground">{label}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="type-label m-0 uppercase text-muted-foreground">
          {orders} orders · {free} vehicles free · {workshop} in workshop
        </p>
        <div className="flex gap-2 [&>*]:flex-1">{actions}</div>
      </section>
    </div>
  )
}

export interface PlanPanelProps {
  plan: PlanDto
  trips: readonly TripDto[]
  vehicles: readonly PlanVehicleOptionDto[]
  /** Opens the wizard on a vehicle; undefined when the plan takes no edits (no `edits` link). */
  onEditVehicle?: (vehicleId: string, tripNo?: number) => void
  onAddVehicle?: () => void
  onConfirm: () => void
}

/** 09: how much of the day is planned, and one card per vehicle with its trips. */
export function PlanPanel({ plan, trips, vehicles, onEditVehicle, onAddVehicle, onConfirm }: PlanPanelProps) {
  const total = plan.summary.plannedOrders + plan.summary.unplanned
  const byVehicle = new Map<string, TripDto[]>()
  for (const trip of trips) byVehicle.set(trip.vehicleId, [...(byVehicle.get(trip.vehicleId) ?? []), trip])
  const issues = trips.filter((t) => t.violations.some((v) => v.severity === 'HARD')).length
  const option = (id: string) => vehicles.find((v) => v.vehicleId === id)

  return (
    <div className="flex min-w-px flex-1 flex-col items-stretch gap-4 self-start">
      <section className="flex items-center gap-6 rounded-lg border border-border bg-background px-5 py-4">
        <div className="flex flex-col gap-2">
          <h2 className="type-section m-0 text-foreground">
            {plan.summary.plannedOrders} of {total} orders planned
          </h2>
          <Bar value={percent(plan.summary.plannedOrders, total)} className="h-1.5 w-[280px]" />
          <p className="type-body-small m-0 text-muted-foreground">
            {byVehicle.size} vehicles · {trips.length} trips ·{' '}
            {issues === 0 ? 'every trip passes its checks' : `${issues} trips need attention`}
          </p>
        </div>
        <div className="flex-1" />
        <Button variant="primary" onClick={onConfirm} disabled={trips.length === 0}>
          Confirm trips
        </Button>
      </section>

      <div className="flex flex-wrap items-start gap-4">
        {[...byVehicle.entries()].map(([vehicleId, own]) => {
          const vehicle = option(vehicleId)
          const first = own[0]
          if (!first) return null
          const passes = own.every((t) => !t.violations.some((v) => v.severity === 'HARD'))
          const stops = own.reduce((n, t) => n + t.stops.length, 0)
          const canAddTrip = own.length < 2 && (vehicle?.tripsLeft ?? 0) > 0
          return (
            <article key={vehicleId} className="flex w-[404px] flex-col gap-3 rounded-lg border border-border bg-background p-4">
              <header className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <p className="m-0 font-mono text-[13px] font-bold leading-auto text-foreground">{first.vehicleCode}</p>
                  <p className="type-body-small m-0 text-muted-foreground">
                    {vehicleKind(vehicle?.type ?? 'TRUCK', vehicle?.temp ?? 'AMBIENT')} · {kg(first.weightCapKg)} · {first.volumeCapM3} m³
                  </p>
                </div>
                <StatusChip tone={passes ? 'neutral' : 'danger'}>{passes ? 'Checks pass' : 'Needs attention'}</StatusChip>
              </header>
              {own.map((trip) => {
                const fill = Math.max(percent(trip.loadWeightKg, trip.weightCapKg), percent(trip.loadVolumeM3, trip.volumeCapM3))
                return (
                  <div key={trip.id} className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <p className="type-body-medium m-0 text-foreground">
                        Trip {trip.tripNo} · {BRAND_WORD[trip.brand] ?? trip.brand} · {trip.districtName}
                      </p>
                      <p className="type-data m-0 text-slate-700">
                        {trip.stops.length} stops · {fill}%
                      </p>
                    </div>
                    <Bar value={fill} className="h-1 w-full" />
                    <p className="type-body-small m-0 text-muted-foreground">{trip.stops.map((s) => s.outletName).join(', ')}</p>
                  </div>
                )
              })}
              <footer className="flex items-center justify-between border-t border-slate-100 pt-3">
                {canAddTrip && onEditVehicle ? (
                  <button
                    type="button"
                    className="type-body-medium cursor-pointer border-0 bg-transparent p-0 text-primary hover:underline"
                    onClick={() => onEditVehicle(vehicleId, 2)}
                  >
                    + Add trip 2
                  </button>
                ) : (
                  <span className="type-body-small text-muted-foreground">{stops} stops</span>
                )}
                {onEditVehicle ? (
                  <button
                    type="button"
                    className="type-body-medium flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-foreground hover:underline"
                    onClick={() => onEditVehicle(vehicleId, first.tripNo ?? 1)}
                  >
                    View and edit
                    <Icon name="chevron-right" size={18} />
                  </button>
                ) : null}
              </footer>
            </article>
          )
        })}
        {onAddVehicle ? (
          <button
            type="button"
            onClick={onAddVehicle}
            className="flex h-[200px] w-[404px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-transparent hover:bg-slate-50"
          >
            <span className="type-body-medium text-primary">+ Add vehicle</span>
            <span className="type-body-small text-muted-foreground">Pick a vehicle and give it orders</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** A thin progress bar in the primary tone, or red past full. */
export function Bar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'danger' }) {
  return (
    <span role="presentation" className={`relative block overflow-hidden rounded-full bg-muted ${className ?? ''}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${tone === 'danger' ? 'bg-status-danger-icon' : 'bg-primary'}`}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </span>
  )
}
