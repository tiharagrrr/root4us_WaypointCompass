// Figma: 06 Add vehicle · Vehicle · 265:2419, beside the vehicle table. The frame has no such
// panel; it is the same "Card / Not planned yet" (271:4604) material, grouped the way a trip is
// built, so the dispatcher sizes the vehicle against what is actually waiting.
import type { PlanVehicleOptionDto, UnplannedOrderDto } from '@compass/api-client'
import { useMemo } from 'react'
import { Icon } from '@/ui/icon'
import { StatusChip } from '@/ui/status-chip'
import { BRAND_GLYPH, BRAND_WORD, kg, m3, vehicleKind } from './plan-copy'

export interface WaitingOrdersProps {
  /** The day's orders on no trip; undefined while they load. */
  orders: readonly UnplannedOrderDto[] | undefined
  districtName: (districtId: string) => string
  /** The vehicle picked so far, so its capacity sits next to the demand. */
  vehicle: PlanVehicleOptionDto | undefined
}

interface Group {
  key: string
  brand: string
  districtId: string
  orders: readonly UnplannedOrderDto[]
  weightKg: number
  volumeM3: number
  chilled: number
}

/** One group per brand and district, heaviest first: a trip carries exactly one of these. */
function groupOrders(orders: readonly UnplannedOrderDto[]): Group[] {
  const groups = new Map<string, Group>()
  for (const order of orders) {
    const key = `${order.brand}|${order.districtId}`
    const group = groups.get(key) ?? { key, brand: order.brand, districtId: order.districtId, orders: [], weightKg: 0, volumeM3: 0, chilled: 0 }
    groups.set(key, {
      ...group,
      orders: [...group.orders, order],
      weightKg: group.weightKg + order.weightKg,
      volumeM3: group.volumeM3 + order.volumeM3,
      chilled: group.chilled + (order.tempClass === 'CHILLED' ? 1 : 0),
    })
  }
  return [...groups.values()].sort((a, b) => b.weightKg - a.weightKg)
}

/**
 * 06: what the trip is being built for. The vehicle table alone says nothing about the day's
 * orders, so this lists them grouped by brand and district, with the day's totals and the picked
 * vehicle's capacity to compare them against. It states figures only — whether an order fits is
 * the engine's answer, given on the orders step.
 */
export function WaitingOrders({ orders, districtName, vehicle }: WaitingOrdersProps) {
  const list = useMemo(() => orders ?? [], [orders])
  const groups = useMemo(() => groupOrders(list), [list])
  const totals = useMemo(
    () =>
      list.reduce(
        (sum, o) => ({ weightKg: sum.weightKg + o.weightKg, volumeM3: sum.volumeM3 + o.volumeM3, chilled: sum.chilled + (o.tempClass === 'CHILLED' ? 1 : 0) }),
        { weightKg: 0, volumeM3: 0, chilled: 0 },
      ),
    [list],
  )

  return (
    <section
      aria-label="Waiting for a vehicle"
      className="flex max-h-[470px] w-[320px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-page"
    >
      <header className="flex flex-col gap-1 border-b border-border px-3.5 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <h3 className="type-card-title m-0 text-foreground">Waiting for a vehicle</h3>
          <span className="font-mono text-[12px] font-bold text-muted-foreground">{list.length}</span>
        </div>
        {list.length ? (
          <p className="type-mono-small m-0 uppercase text-muted-foreground">
            {kg(totals.weightKg)} · {m3(totals.volumeM3)}
            {totals.chilled ? ` · ${totals.chilled} chilled` : ''}
          </p>
        ) : null}
        {vehicle || list.length ? (
          <p className="type-caption m-0 leading-[17.4px] text-muted-foreground">
            {vehicle
              ? `${vehicle.code} · ${vehicleKind(vehicle.type, vehicle.temp)} holds ${kg(vehicle.weightCapKg)} · ${m3(vehicle.volumeCapM3)}.`
              : 'A trip takes one brand and one district. Pick a vehicle that fits one of these.'}
          </p>
        ) : null}
      </header>
      {orders === undefined ? (
        <p className="type-body-small m-0 px-3.5 py-6 text-center text-muted-foreground">Loading the day’s orders…</p>
      ) : list.length === 0 ? (
        <p className="type-body-small m-0 px-3.5 py-6 text-center text-muted-foreground">
          Nothing is waiting. Every order for this day is already on a trip.
        </p>
      ) : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-2.5">
          {groups.map((group) => {
            const glyph = BRAND_GLYPH[group.brand] ?? BRAND_GLYPH.FRESH
            return (
              <li key={group.key}>
                <article className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-background px-[13px] py-[11px]">
                  <div className="flex items-start justify-between gap-2">
                    <p className="m-0 flex items-center gap-1.5 font-sans text-[13px] font-bold leading-[18.85px] text-foreground">
                      <Icon name={glyph.icon} size={14} className={glyph.className} />
                      {BRAND_WORD[group.brand] ?? group.brand} · {districtName(group.districtId)}
                    </p>
                    {group.chilled ? <StatusChip tone="neutral">Chilled</StatusChip> : null}
                  </div>
                  <p className="type-mono-small m-0 text-muted-foreground">
                    {group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'} · {kg(group.weightKg)} · {m3(group.volumeM3)}
                  </p>
                  <ul className="m-0 flex list-none flex-col p-0">
                    {group.orders.map((order) => (
                      <li key={order.orderId} className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-1.5 first-of-type:border-t-0 first-of-type:pt-0">
                        <span className="type-body-small min-w-px flex-1 truncate text-slate-700">{order.outletName}</span>
                        <span className="type-mono-small text-muted-foreground">{order.orderNo}</span>
                        <span className="font-mono text-[12px] font-bold text-foreground">{kg(order.weightKg)}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
