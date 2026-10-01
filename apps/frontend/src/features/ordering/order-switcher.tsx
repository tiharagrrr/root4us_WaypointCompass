// Figma: M1 New order · 185:10376 ("Stack / Orders · Wed 30 Sep"), M1b 228:970, M2 185:10649
import type { OrderDto } from '@compass/api-client'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { classLabel, dayLabel, kg, positionLabel, timeLabel } from './order-format'

const HINT = 'Place each order on its own: pick it, add items, send it, then move to the next.'

export interface OrderSwitcherProps {
  /** The business date these orders are for; its label heads the column. */
  day: string
  orders: readonly OrderDto[]
  selectedId: string | null
  onSelect: (order: OrderDto) => void
  loading?: boolean
}

/**
 * The day's orders, one card each, with the open one marked. A store places one order per class,
 * so this is where M1 (dry), M1b (chilled, with the dry one already sent) and M2 (rolled to the
 * following run) differ: the cards, not the screen.
 */
export function OrderSwitcher({ day, orders, selectedId, onSelect, loading }: OrderSwitcherProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-label m-0 uppercase text-muted-foreground">Orders · {loading ? '…' : dayLabel(day)}</p>
      {loading ? (
        <>
          <Skeleton className="h-[70px] w-full rounded-lg" />
          <Skeleton className="h-[70px] w-full rounded-lg" />
        </>
      ) : (
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            orders={orders}
            selected={order.id === selectedId}
            onSelect={() => onSelect(order)}
          />
        ))
      )}
      <p className="type-caption m-0 leading-[17.4px] text-muted-foreground">{HINT}</p>
    </div>
  )
}

interface OrderCardProps {
  order: OrderDto
  orders: readonly OrderDto[]
  selected: boolean
  onSelect: () => void
}

function OrderCard({ order, orders, selected, onSelect }: OrderCardProps) {
  const sent = order.status !== 'DRAFT'
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-[15px] py-[13px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
        selected ? 'border-blue-700 bg-accent' : 'border-border bg-background hover:bg-slate-50',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn('type-card-title', selected ? 'text-primary' : 'text-foreground')}>{classLabel(order.tempClass)}</span>
        {sent ? (
          <StatusChip tone="success" className="bg-status-success-bg">
            Sent
          </StatusChip>
        ) : (
          <StatusChip>Draft</StatusChip>
        )}
      </span>
      <span className="type-caption leading-[17.4px] text-muted-foreground">{summaryOf(order, orders)}</span>
    </button>
  )
}

/**
 * The card's second line. A sent order names when it went and its order number, an order that
 * rolled past the cutoff says so, and a draft counts its items.
 */
function summaryOf(order: OrderDto, orders: readonly OrderDto[]): string {
  const weight = `${kg(order.totals.weightKg)} kg`
  if (order.status !== 'DRAFT' && order.submittedAt) {
    return `Sent ${timeLabel(order.submittedAt)} · #${order.orderNo} · ${weight}`
  }
  const middle = order.afterCutoff ? 'following run' : `${order.totals.lines} items`
  return `${positionLabel(orders, order)} · ${middle} · ${weight}`
}
