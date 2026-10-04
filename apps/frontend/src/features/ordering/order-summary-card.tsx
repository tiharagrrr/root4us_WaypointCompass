// Figma: M1 New order · 185:10376 ("Card / Dry order"), M1b 228:970, M2 185:10649
import type { OrderDto } from '@compass/api-client'
import type { ReactNode } from 'react'
import { Card } from '@/ui/card'
import { StatusChip } from '@/ui/status-chip'
import { CutoffCard } from './cutoff-card'
import { sendHint } from './order-copy'
import { classLabel, deliveryLabel, kg, m3, positionLabel } from './order-format'

const VALUE = 'font-mono text-[12px] font-bold leading-auto text-foreground'

export interface OrderSummaryCardProps {
  order: OrderDto
  /** The day's orders: the count, and what the send hint says about the other one. */
  orders: readonly OrderDto[]
  now: Date
  /** The Send button, rendered from the order's submit link by the page. */
  action?: ReactNode
}

/** What the order adds up to, when it is delivered, and the one button that sends it. */
export function OrderSummaryCard({ order, orders, now, action }: OrderSummaryCardProps) {
  const rolled = order.afterCutoff && order.deliveryDate !== order.requestedDate
  return (
    <Card className="flex w-full shrink-0 flex-col sm:w-[320px]">
      <div className="flex items-center gap-3 border-b border-border px-4 pb-[13px] pt-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="type-card-title m-0 text-foreground">{classLabel(order.tempClass)}</h2>
          <p className="type-caption m-0 text-muted-foreground">
            {positionLabel(orders, order)} · {order.afterCutoff ? 'following run' : 'auto-totalled from items'}
          </p>
        </div>
      </div>

      <div className="flex flex-col px-4 pb-4 pt-1">
        <Row label="Items">
          <span className={VALUE}>
            {order.totals.lines} lines · {order.totals.units} packs
          </span>
        </Row>
        <Row label="Weight">
          <span className={VALUE}>{kg(order.totals.weightKg)} kg</span>
        </Row>
        <Row label="Volume">
          <span className={VALUE}>{m3(order.totals.volumeM3)} m³</span>
        </Row>
        <div className="flex items-center justify-between py-2.5">
          <span className="type-body text-foreground">Storage</span>
          <StatusChip>{order.tempClass}</StatusChip>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border pb-3 pt-[13px]">
          <p className="type-label m-0 uppercase text-muted-foreground">Delivery</p>
          {rolled ? (
            <p className="type-body-strong m-0 text-slate-400">{deliveryLabel(order.requestedDate, order.deliveryWindow)}</p>
          ) : null}
          <p className="type-body-strong m-0 text-foreground">{deliveryLabel(order.deliveryDate, order.deliveryWindow)}</p>
        </div>

        <CutoffCard order={order} now={now} />

        {action ? (
          <div className="flex flex-col gap-2 pt-4">
            {action}
            <p className="type-caption m-0 text-center leading-[17.4px] text-muted-foreground">{sendHint(order, orders)}</p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between whitespace-nowrap border-b border-slate-100 pb-[11px] pt-2.5">
      <span className="type-body text-slate-700">{label}</span>
      {children}
    </div>
  )
}
