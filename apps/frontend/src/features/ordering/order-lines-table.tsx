// Figma: M1 New order · 185:10376 ("Table"), M1b 228:970
import type { OrderDto, OrderLineDto } from '@compass/api-client'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { getLink } from '@/lib/links'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { classLabel, classLabelInline, kg, m3, positionLabel } from './order-format'

export interface OrderLinesTableProps {
  order: OrderDto
  /** The day's orders, for the "ORDER 1 OF 2" count. */
  orders: readonly OrderDto[]
  lines: readonly OrderLineDto[]
  loading?: boolean
  /** Rendered in the table's title row: the Add item button (M1a's trigger). */
  action?: ReactNode
  /** Commits a new quantity for a line. Rejected changes fall back to the line's own quantity. */
  onChangeQty: (line: OrderLineDto, qty: number) => void
  /** A write is in flight: the table stays readable but takes no more edits. */
  busy?: boolean
}

/** The lines of the open order, with the quantity editable in place while the order is editable. */
export function OrderLinesTable({ order, orders, lines, loading, action, onChangeQty, busy }: OrderLinesTableProps) {
  const editable = Boolean(getLink(order._links, 'setLines'))
  return (
    <TableContainer className="w-[568px] shrink-0" aria-busy={busy || undefined}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-[13px] pt-3">
        <div className="flex items-center gap-2.5">
          <h2 className="type-card-title m-0 text-foreground">{classLabel(order.tempClass)}</h2>
          <StatusChip>{order.tempClass}</StatusChip>
        </div>
        <div className="flex items-center gap-3">
          <span className="type-metadata uppercase text-muted-foreground">{positionLabel(orders, order)}</span>
          {action}
        </div>
      </div>
      {loading ? (
        <LinesSkeleton />
      ) : lines.length === 0 ? (
        <EmptyState
          title="No items yet"
          description={`Add the items this ${classLabelInline(order.tempClass)} needs, then send it.`}
        />
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead className="w-[206px]">Item</TableHead>
              <TableHead className="w-[90px]">Pack</TableHead>
              <TableHead className="w-[110px]">Qty</TableHead>
              <TableHead className="w-[80px] text-right">kg</TableHead>
              <TableHead className="w-[80px] text-right">m³</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id} className="h-[49px]">
                <TableCell>
                  <div className="flex flex-col gap-px">
                    <span className="font-sans text-[13px] font-medium leading-auto text-foreground">{line.name}</span>
                    <span className="type-mono-small text-muted-foreground">{line.sku}</span>
                  </div>
                </TableCell>
                <TableCell className="type-caption leading-[17.4px] text-muted-foreground">{line.packLabel}</TableCell>
                <TableCell>
                  <QtyInput line={line} editable={editable && !busy} onCommit={(qty) => onChangeQty(line, qty)} />
                </TableCell>
                <TableCell className="type-metadata text-right text-slate-700">{kg(line.weightKg)}</TableCell>
                <TableCell className="type-metadata text-right text-slate-700">{m3(line.volumeM3)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableContainer>
  )
}

interface QtyInputProps {
  line: OrderLineDto
  editable: boolean
  onCommit: (qty: number) => void
}

/**
 * Packs for one line. The change goes to the API on blur or Enter, never on every keystroke, and
 * the field follows the line again as soon as it is committed or abandoned.
 */
function QtyInput({ line, editable, onCommit }: QtyInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? String(line.qty)

  const commit = () => {
    const qty = Number(value)
    setDraft(null)
    if (!Number.isInteger(qty) || qty < 1) return
    if (qty !== line.qty) onCommit(qty)
  }

  return (
    <input
      type="number"
      min={1}
      inputMode="numeric"
      aria-label={`${line.name}, packs`}
      value={value}
      disabled={!editable}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      className={cn(
        'type-data-bold h-8 w-[66px] rounded-md border border-input bg-background text-center text-[12px] text-foreground outline-none transition-colors',
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
      )}
    />
  )
}

function LinesSkeleton() {
  return (
    <div data-slot="lines-skeleton" className="flex flex-col">
      <div className="h-9 bg-page" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex h-[49px] items-center gap-3 border-t border-slate-100 px-3">
          <div className="flex w-[194px] flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="ml-3 h-8 w-[66px]" />
          <Skeleton className="ml-auto h-3.5 w-10" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ))}
    </div>
  )
}
