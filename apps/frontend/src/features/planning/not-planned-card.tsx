// Figma: 05 Plan · empty · 265:2134, "Card / Not planned yet" (271:4604); with reasons on 09 (271:3785).
import type { UnplannedOrderDto } from '@compass/api-client'
import type { EngineInput } from '@waypoint/engine'
import { useMemo, useState } from 'react'
import { Icon } from '@/ui/icon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { BRAND_GLYPH, BRAND_WORD, kg } from './plan-copy'

const ALL = 'all'

export interface NotPlannedCardProps {
  orders: readonly UnplannedOrderDto[] | undefined
  input: EngineInput | undefined
  /** 09 says why each order is left; 05 has not planned anything yet. */
  withReasons: boolean
  /** 14 calls it "Unplanned" with its own line under the title. */
  heading?: { title: string; caption: string }
}

/** The orders on no trip, filterable by brand and district, heaviest decisions first. */
export function NotPlannedCard({ orders, input, withReasons, heading }: NotPlannedCardProps) {
  const [brand, setBrand] = useState(ALL)
  const [district, setDistrict] = useState(ALL)
  const list = useMemo(() => orders ?? [], [orders])
  const districtName = (id: string) => input?.districts[id]?.name ?? id
  const vanOnly = (outletId: string) => input?.outlets[outletId]?.parkingConstraint === 'VAN_ONLY'

  const brands = useMemo(() => ['FRESH', 'STYLE', 'TECH'].map((b) => [b, list.filter((o) => o.brand === b).length] as const), [list])
  const districts = useMemo(() => [...new Set(list.map((o) => o.districtId))].sort(), [list])
  const shown = list.filter((o) => (brand === ALL || o.brand === brand) && (district === ALL || o.districtId === district))
  const openCount = list.filter((o) => o.orderStatus === 'SUBMITTED').length

  return (
    <section
      aria-label={heading?.title ?? 'Not planned yet'}
      className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background p-px shadow-sm"
    >
      <header className="flex flex-col gap-2 border-b border-border px-3.5 pb-[13px] pt-3">
        <div className="flex items-center justify-between">
          <h2 className="type-card-title m-0 text-foreground">{heading?.title ?? 'Not planned yet'}</h2>
          <span className="font-mono text-[12px] font-bold leading-auto text-muted-foreground">{list.length}</span>
        </div>
        {withReasons ? (
          <p className="type-caption m-0 leading-[17.4px] text-muted-foreground">
            {heading?.caption ?? 'Pick the next vehicle to fit these. Anything left goes to step 3 with its reason.'}
          </p>
        ) : (
          <p className="type-caption m-0 leading-[17.4px] text-muted-foreground">
            {brands.map(([b, n]) => `${BRAND_WORD[b]} ${n}`).join(' · ')}
          </p>
        )}
        {openCount > 0 ? (
          <p className="type-caption m-0 leading-[17.4px] text-status-info-fg">
            {openCount === 1 ? '1 order is' : `${openCount} orders are`} still open until the cutoff. Plan them now; if the store
            changes one, it comes off the draft and back here.
          </p>
        ) : null}
        {withReasons ? null : (
          <div className="flex gap-1.5">
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger size="sm" aria-label="Brand" className="w-auto gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All brands</SelectItem>
                {brands.map(([b]) => (
                  <SelectItem key={b} value={b}>
                    {BRAND_WORD[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger size="sm" aria-label="District" className="w-auto gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All districts</SelectItem>
                {districts.map((d) => (
                  <SelectItem key={d} value={d}>
                    {districtName(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-2.5">
        {orders === undefined
          ? Array.from({ length: 5 }, (_, i) => (
              <li key={i}>
                <Skeleton className="h-[59px] w-full" />
              </li>
            ))
          : shown.map((order) => (
              <li key={order.orderId}>
                <OrderCard
                  order={order}
                  district={districtName(order.districtId)}
                  vanOnly={vanOnly(order.outletId)}
                  reason={withReasons ? (order.reasonLabel ?? 'Needs a decision in step 3.') : undefined}
                />
              </li>
            ))}
      </ul>
    </section>
  )
}

export interface OrderCardProps {
  order: Pick<UnplannedOrderDto, 'orderNo' | 'outletName' | 'brand' | 'tempClass' | 'weightKg'> &
    Partial<Pick<UnplannedOrderDto, 'orderStatus'>>
  district: string
  vanOnly?: boolean
  reason?: string
}

/** One order: outlet, order number, district, weight and its handling chips. */
export function OrderCard({ order, district, vanOnly, reason }: OrderCardProps) {
  const glyph = BRAND_GLYPH[order.brand] ?? BRAND_GLYPH.FRESH
  const chilled = order.tempClass === 'CHILLED'
  // Before the cutoff the store may still change it; a change takes it off the draft.
  const open = order.orderStatus === 'SUBMITTED'
  return (
    <article className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-background px-[13px] py-[11px]">
      <div className="flex items-start gap-2">
        <div className="flex min-w-px flex-1 flex-col gap-0.5">
          <p className="m-0 flex items-center gap-1.5 font-sans text-[13px] font-bold leading-[18.85px] text-foreground">
            <Icon name={glyph.icon} size={14} className={glyph.className} />
            {order.outletName}
          </p>
          <p className="type-mono-small m-0 text-muted-foreground">
            {order.orderNo} · {district}
          </p>
        </div>
        <span className="font-mono text-[12px] font-bold leading-auto text-foreground">{kg(order.weightKg)}</span>
      </div>
      {chilled || vanOnly || open ? (
        <div className="flex gap-1.5">
          {open ? <StatusChip tone="info">Open until cutoff</StatusChip> : null}
          {chilled ? <StatusChip tone="neutral">Chilled</StatusChip> : null}
          {vanOnly ? <StatusChip tone="neutral">Van-only</StatusChip> : null}
        </div>
      ) : null}
      {reason ? <p className="type-caption m-0 leading-[17.4px] text-muted-foreground">{reason}</p> : null}
    </article>
  )
}
