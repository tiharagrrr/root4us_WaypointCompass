// Figma: 07 Add vehicle · Orders · 488:9309 (dialog 488:9543)
import type { PlanVehicleOptionDto } from '@compass/api-client'
import type { EngineInput, OrderOption, Plan } from '@waypoint/engine'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { SegmentedControl } from '@/ui/segmented-control'
import { StatusChip } from '@/ui/status-chip'
import { Bar } from './plan-panels'
import { BRAND_GLYPH, BRAND_WORD, RULE_CHIP, clock, kg, percent, vehicleKind } from './plan-copy'
import type { DraftPreview, TripDraft } from './trip-draft'

export interface OrdersStepProps {
  input: EngineInput
  plan: Plan
  vehicle: PlanVehicleOptionDto
  depotName: string
  draft: TripDraft
  preview: DraftPreview
  /** Outlet names, from the unplanned orders and the trips' stops (the engine context has none). */
  outletName: (outletId: string | undefined) => string | undefined
  onChange: (orderIds: string[]) => void
  onPickTrip: (tripNo: number) => void
}

/**
 * 07: the vehicle's trips on the left, the orders that could go on the trip in the middle (fits
 * first, blocked ones dimmed with why), and the trip as the engine times it on the right. Every
 * figure comes from the engine running in the browser, so it changes as orders are added.
 */
export function OrdersStep({ input, plan, vehicle, depotName, draft, preview, outletName, onChange, onPickTrip }: OrdersStepProps) {
  const [filter, setFilter] = useState<'all' | 'fits'>('all')
  const orderOf = (id: string) => input.orders.find((o) => o.id === id)
  const districtName = (id: string) => input.districts[id]?.name ?? id
  const fits = preview.options.filter((o) => o.status !== 'BLOCKED')
  const shown = filter === 'all' ? preview.options : fits
  const trip = preview.trip
  const own = plan.trips.filter((t) => t.vehicleId === draft.vehicleId).map((t) => t.tripNo)
  const tripNos = [...new Set([...own, draft.tripNo])].sort()
  const first = orderOf(draft.orderIds[0] ?? '')
  const weightPct = percent(trip?.weightKg ?? 0, vehicle.weightCapKg)
  const volumePct = percent(trip?.volumeM3 ?? 0, vehicle.volumeCapM3)
  const canAddTrip = tripNos.length < 2 && vehicle.tripsLeft > (own.includes(draft.tripNo) ? 0 : 1)

  return (
    <div className="flex items-start gap-4 px-5 py-3.5">
      <nav aria-label="Trips" className="flex w-[200px] shrink-0 flex-col gap-2">
        <span className="type-label uppercase text-muted-foreground">Trips</span>
        {tripNos.map((no) => {
          const active = no === draft.tripNo
          const stops = active ? draft.orderIds.length : (plan.trips.find((t) => t.vehicleId === draft.vehicleId && t.tripNo === no)?.orderIds.length ?? 0)
          return (
            <button
              key={no}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onPickTrip(no)}
              className={cn(
                'flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5 text-left',
                active ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-slate-50',
              )}
            >
              <span className="type-body-medium text-foreground">Trip {no}</span>
              {active && trip ? (
                <>
                  <span className="type-body-small text-muted-foreground">
                    {BRAND_WORD[trip.brand]} · {districtName(trip.districtId)} · {clock(trip.departMin)}
                  </span>
                  <Bar value={Math.max(weightPct, volumePct)} className="h-1 w-full" />
                </>
              ) : null}
              <span className="type-data text-slate-700">
                {stops} stops{active && trip ? ` · ${Math.max(weightPct, volumePct)}%` : ''}
              </span>
            </button>
          )
        })}
        {canAddTrip ? (
          <button
            type="button"
            className="type-body-medium cursor-pointer border-0 bg-transparent p-0 text-left text-primary hover:underline"
            onClick={() => onPickTrip(draft.tripNo === 1 ? 2 : 1)}
          >
            + Add trip {draft.tripNo === 1 ? 2 : 1}
          </button>
        ) : null}
        <p className="type-caption m-0 text-muted-foreground">A vehicle can run up to 2 trips a day.</p>
      </nav>

      <section aria-label="Orders" className="flex w-[340px] shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="type-card-title m-0 text-foreground">Orders</h3>
          <SegmentedControl<'all' | 'fits'>
            aria-label="Show"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: preview.options.length },
              { value: 'fits', label: 'Can add', count: fits.length },
            ]}
          />
        </div>
        <ul className="m-0 flex max-h-[470px] list-none flex-col gap-2 overflow-y-auto p-0">
          {shown.map((option) => (
            <li key={option.orderId}>
              <OptionCard
                option={option}
                outlet={outletName(orderOf(option.orderId)?.outletId)}
                district={districtName(orderOf(option.orderId)?.districtId ?? '')}
                brand={orderOf(option.orderId)?.brand ?? 'FRESH'}
                chilled={orderOf(option.orderId)?.tempClass === 'CHILLED'}
                weightKg={orderOf(option.orderId)?.weightKg ?? 0}
                volumeM3={orderOf(option.orderId)?.volumeM3 ?? 0}
                onAdd={() => onChange([...draft.orderIds, option.orderId])}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={`${vehicle.code} trip ${draft.tripNo}`} className="flex min-w-px flex-1 flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <header className="flex items-center gap-2.5 border-b border-border pb-[13px]">
          <span className="font-mono text-[13px] font-bold text-foreground">{vehicle.code}</span>
          <span className="type-caption text-slate-700">{vehicleKind(vehicle.type, vehicle.temp)}</span>
          <span className="type-card-title text-foreground">Trip {draft.tripNo}</span>
          <span className="type-caption text-muted-foreground">Home · {depotName}</span>
          <span className="flex-1" />
          <StatusChip tone="neutral">Draft</StatusChip>
        </header>
        <div className="flex items-center gap-2">
          <span className="type-label uppercase text-muted-foreground">Brand</span>
          <StatusChip tone="neutral">{first ? `${BRAND_WORD[first.brand]} · locked` : 'Set by first order'}</StatusChip>
          <span className="type-label pl-2 uppercase text-muted-foreground">District</span>
          <StatusChip tone="neutral">{first ? `${districtName(first.districtId)} · locked` : '—'}</StatusChip>
        </div>
        <Meter label="Weight" value={`${kg(trip?.weightKg ?? 0).replace(' kg', '')} / ${kg(vehicle.weightCapKg)} · ${weightPct}%`} pct={weightPct} />
        <Meter label="Volume" value={`${(trip?.volumeM3 ?? 0).toFixed(1)} / ${vehicle.volumeCapM3.toFixed(1)} m³ · ${volumePct}%`} pct={volumePct} />
        <div className="flex flex-col">
          <p className="m-0 flex items-center gap-2 pb-2">
            <span className="font-sans text-[13px] font-bold leading-[18.85px] text-foreground">{depotName} depot</span>
            {trip ? <span className="type-mono-small text-muted-foreground">DEPARTS {clock(trip.departMin)}</span> : null}
          </p>
          <ol className="m-0 list-none p-0">
            {(trip?.stops ?? []).map((stop, i) => {
              const order = orderOf(stop.orderId)
              const glyph = BRAND_GLYPH[order?.brand ?? 'FRESH'] ?? BRAND_GLYPH.FRESH
              return (
                <li key={stop.orderId} className="flex items-center gap-2 border-t border-slate-100 pb-2.5 pt-[11px]">
                  <span className="w-[28.5px] font-mono text-[12px] font-bold text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex w-[236px] flex-col gap-px">
                    <span className="flex items-center gap-1.5 font-sans text-[13px] font-bold leading-[18.85px] text-foreground">
                      <Icon name={glyph.icon} size={14} className={glyph.className} />
                      {outletName(order?.outletId) ?? order?.ref}
                    </span>
                    <span className="type-mono-small text-muted-foreground">{order?.ref}</span>
                  </span>
                  <span className="flex w-[110px] flex-col gap-px">
                    <span className="font-mono text-[13px] font-bold text-foreground">{clock(stop.arriveMin)}</span>
                    <span className="type-mono-small text-muted-foreground">
                      {clock(stop.windowOpenMin)}–{clock(stop.windowCloseMin)}
                    </span>
                  </span>
                  <span className="w-[80.5px] font-mono text-[12px] font-bold text-foreground">{kg(order?.weightKg ?? 0)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${order?.ref ?? 'order'}`}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-500 hover:bg-slate-100"
                    onClick={() => onChange(draft.orderIds.filter((id) => id !== stop.orderId))}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="pt-2">
            <p className="type-body-small m-0 flex h-[46px] items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-700">
              Pick orders on the left to add stops
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function Meter({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-start justify-between">
        <span className="type-label uppercase text-muted-foreground">{label}</span>
        <span className="font-mono text-[12px] font-bold text-slate-700">{value}</span>
      </div>
      <Bar value={pct} className="h-1.5 w-full" />
    </div>
  )
}

interface OptionCardProps {
  option: OrderOption
  outlet: string | undefined
  district: string
  brand: string
  chilled: boolean
  weightKg: number
  volumeM3: number
  onAdd: () => void
}

function OptionCard({ option, outlet, district, brand, chilled, weightKg, volumeM3, onAdd }: OptionCardProps) {
  const glyph = BRAND_GLYPH[brand] ?? BRAND_GLYPH.FRESH
  const blocked = option.status === 'BLOCKED'
  const why = option.blocking[0] ?? option.warnings[0]
  return (
    <article
      className={cn(
        'flex flex-col gap-1.5 rounded-md border px-[13px] py-[11px]',
        blocked ? 'border-slate-100 bg-page' : 'border-slate-200 bg-background',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-px flex-1 flex-col gap-0.5">
          <p className={cn('m-0 flex items-center gap-1.5 font-sans text-[13px] font-bold leading-[18.85px]', blocked ? 'text-muted-foreground' : 'text-foreground')}>
            <Icon name={glyph.icon} size={14} className={glyph.className} />
            {outlet ?? option.ref}
          </p>
          <p className="type-mono-small m-0 text-muted-foreground">
            {option.ref} · {district}
          </p>
        </div>
        {blocked ? (
          <span className="font-mono text-[12px] font-bold text-muted-foreground">{kg(weightKg)}</span>
        ) : (
          <Button size="sm" variant="outline" onClick={onAdd} className="h-7">
            Add
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {blocked ? null : (
          <span className="font-mono text-[11px] font-bold text-slate-700">
            {kg(weightKg)} · {volumeM3.toFixed(1)} m³
          </span>
        )}
        {chilled && !blocked ? <StatusChip tone="neutral">Chilled</StatusChip> : null}
        {why ? (
          <StatusChip tone={blocked ? 'neutral' : 'warning'} title={why.message}>
            {RULE_CHIP[why.rule] ?? why.rule}
          </StatusChip>
        ) : null}
      </div>
    </article>
  )
}
