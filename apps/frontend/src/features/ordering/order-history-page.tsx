// Figma: M8 Order history · 185:11842
import { useOrdersList, useOrdersReorder, type OrderDto, type OrdersListParams } from '@compass/api-client'
import { addDays } from '@waypoint/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { serverNow } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { SegmentedControl } from '@/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip, type StatusTone } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { OrderTimelineDialog } from '@/features/audit/order-timeline-dialog'
import { brandWord } from './order-copy'
import { dayLabel } from './order-format'

/** Orders that have finished their journey, one way or another. */
const HISTORY = 'DELIVERED,PARTIAL,RECEIVED,ISSUE_REPORTED,FAILED,CANCELLED'

const PERIODS = [30, 90, 365] as const
type Period = (typeof PERIODS)[number]

const ALL_TYPES = 'ALL'
type TypeFilter = typeof ALL_TYPES | 'AMBIENT' | 'CHILLED'

/** The chip's word and tone; the frame draws DELIVERED neutral, PARTIAL and ISSUE red. */
const STATUS: Record<string, { word: string; tone: StatusTone }> = {
  DELIVERED: { word: 'DELIVERED', tone: 'neutral' },
  RECEIVED: { word: 'DELIVERED', tone: 'neutral' },
  PARTIAL: { word: 'PARTIAL', tone: 'danger' },
  ISSUE_REPORTED: { word: 'ISSUE', tone: 'danger' },
  FAILED: { word: 'FAILED', tone: 'danger' },
  CANCELLED: { word: 'CANCELLED', tone: 'muted' },
}

const kind = (o: OrderDto) => `${brandWord(o.brand)} · ${o.tempClass === 'CHILLED' ? 'Chilled' : 'Dry'}`

/** What the row says beside its status: why it was cancelled, or the note the store left. */
const notes = (o: OrderDto) => (o.status === 'CANCELLED' ? (o.cancelReason ?? 'Cancelled') : (o.note ?? ''))

type Filters = OrdersListParams & { 'filter[deliveryDate][gte]'?: string }

/**
 * M8: the outlet's past orders, newest first. Reorder copies an order's items into a new draft for
 * the next open date (AC-ORD-07) and opens it on M1; Timeline shows every step the order went
 * through. Both appear only while the order carries the link.
 */
export function OrderHistoryPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>(30)
  const [type, setType] = useState<TypeFilter>(ALL_TYPES)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(10)
  const [timeline, setTimeline] = useState<OrderDto | null>(null)
  usePageHeader({ eyebrow: 'Orders', title: 'Orders' })

  const filters: Filters = {
    'filter[status]': HISTORY,
    'filter[deliveryDate][gte]': addDays(toColomboDate(serverNow()), -period),
    ...(type === ALL_TYPES ? {} : { 'filter[tempClass]': type }),
    ...(search.trim() ? { q: search.trim() } : {}),
    sort: '-deliveryDate',
    limit,
    offset,
  }
  const orders = useOrdersList(filters)
  const reorder = useOrdersReorder()
  const list = orders.data?.data ?? []
  const page = orders.data?.meta?.page
  const filtered = search.trim() !== '' || type !== ALL_TYPES

  /** Another search, period or type starts at the first page again. */
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setOffset(0)
    }

  return (
    <div className="flex flex-col gap-3">
      <HeaderActions>
        <SegmentedControl<'ongoing' | 'history'>
          aria-label="Orders"
          value="history"
          onValueChange={(v) => v === 'ongoing' && void navigate('/store/orders')}
          options={[
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'history', label: 'History' },
          ]}
        />
      </HeaderActions>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          aria-label="Search order number"
          placeholder="Search order number"
          className="w-[240px]"
          onChange={(event) => reset(setSearch)(event.target.value)}
        />
        <Select value={String(period)} onValueChange={(v) => reset(setPeriod)(Number(v) as Period)}>
          <SelectTrigger aria-label="Period" size="sm" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={String(p)}>
                Last {p} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => reset(setType)(v as TypeFilter)}>
          <SelectTrigger aria-label="Type" size="sm" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            <SelectItem value="AMBIENT">Dry</SelectItem>
            <SelectItem value="CHILLED">Chilled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : orders.isPending ? (
        <Skeleton className="h-[420px] w-full" />
      ) : list.length === 0 ? (
        <EmptyState
          title="No past orders"
          description={filtered ? 'No order in this period matches.' : 'Orders show here once they are delivered or cancelled.'}
        />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((order) => {
                const status = STATUS[order.status] ?? { word: order.status, tone: 'neutral' as const }
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-[12px] font-bold text-foreground">#{order.orderNo}</TableCell>
                    <TableCell>{kind(order)}</TableCell>
                    <TableCell>{dayLabel(order.deliveryDate)}</TableCell>
                    <TableCell>
                      <StatusChip tone={status.tone}>{status.word}</StatusChip>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{notes(order)}</TableCell>
                    <TableCell>
                      <span className="flex items-center justify-end gap-1">
                        {getLink(order._links, 'timeline') ? (
                          <Button variant="ghost" size="sm" onClick={() => setTimeline(order)}>
                            Timeline
                          </Button>
                        ) : null}
                        <Action
                          link={order._links.reorder}
                          variant="ghost"
                          size="sm"
                          onAction={async ({ headers }) => {
                            await reorder.mutateAsync({ id: order.id, headers })
                            void navigate('/store/orders/new')
                          }}
                        >
                          Reorder
                        </Action>
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {page ? (
            <Pagination
              page={page}
              onOffsetChange={setOffset}
              onLimitChange={(next) => {
                setLimit(next)
                setOffset(0)
              }}
            />
          ) : null}
        </TableContainer>
      )}

      {reorder.isError ? <ErrorState error={reorder.error} /> : null}
      {timeline ? <OrderTimelineDialog orderId={timeline.id} orderNo={timeline.orderNo} onClose={() => setTimeline(null)} /> : null}
    </div>
  )
}
