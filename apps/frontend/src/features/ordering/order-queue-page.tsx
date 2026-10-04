// Figma: 03 Order queue · 185:12856
import { useOrdersList, useOrdersSetPriority, type OrderDto } from '@compass/api-client'
import { addDays } from '@waypoint/shared'
import { useState } from 'react'
import { usePageHeader } from '@/app/layouts/header-slot'
import { toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { serverNow } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip, type StatusTone } from '@/ui/status-chip'
import {
  Table,
  TableBody,
  TableCell,
  TableCellStack,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table'
import { OrderTimelineDialog } from '@/features/audit/order-timeline-dialog'
import { CancelOrderDialog } from './cancel-order-dialog'
import { brandWord, districtLabel } from './order-copy'
import { classLabel, dayLabel, deliveryLabel, kg } from './order-format'

/**
 * The orders a day's plan is built from: sent, confirmed at the cutoff, and the ones an earlier
 * plan deferred onto this run. Cancelled and already-planned orders belong to 04, not the queue.
 */
const QUEUE_STATUSES = 'SUBMITTED,CONFIRMED,DEFERRED'

/** The queue reads district-then-brand order from the server, so the groups fall out in one pass. */
const QUEUE_SORT = 'districtId,brand,orderNo'

const TONE_OF: Record<string, StatusTone> = {
  SUBMITTED: 'info',
  CONFIRMED: 'success',
  DEFERRED: 'warning',
}

interface Group {
  districtId: string
  brand: string
  orders: OrderDto[]
}

/** Consecutive runs of the same district and brand, in the order the server sent them. */
function groupOf(orders: readonly OrderDto[]): Group[] {
  const groups: Group[] = []
  for (const order of orders) {
    const last = groups.at(-1)
    if (last && last.districtId === order.districtId && last.brand === order.brand) last.orders.push(order)
    else groups.push({ districtId: order.districtId, brand: order.brand, orders: [order] })
  }
  return groups
}

/**
 * 03: one day's queue, grouped by district and brand so a dispatcher reads it the way they plan it
 * — a district's run at a time. Marking an order urgent and cancelling it both come from the
 * order's own `_links`, so an order past PLANNED simply has no buttons.
 */
export function OrderQueuePage() {
  const [date, setDate] = useState(() => addDays(toColomboDate(serverNow()), 1))
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(25)
  const [cancelling, setCancelling] = useState<OrderDto | null>(null)
  const [timeline, setTimeline] = useState<OrderDto | null>(null)

  const orders = useOrdersList({
    'filter[deliveryDate]': date,
    'filter[status]': QUEUE_STATUSES,
    sort: QUEUE_SORT,
    ...(search.trim() ? { q: search.trim() } : {}),
    limit,
    offset,
  })
  const priority = useOrdersSetPriority()

  const list = orders.data?.data ?? []
  const page = orders.data?.meta?.page
  const total = page?.total ?? 0
  usePageHeader({
    eyebrow: `ORDER QUEUE · ${dayLabel(date).toUpperCase()}`,
    title: 'Order queue',
  })

  /** Any write re-reads the page rather than patching it: priority re-sorts nothing, but a cancel drops a row. */
  const refresh = () => orders.refetch()

  /** Going to another day or another search starts at the first page again. */
  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setOffset(0)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="type-label uppercase text-muted-foreground">Delivery day</span>
          <Input
            type="date"
            value={date}
            aria-label="Delivery day"
            className="w-[168px]"
            onChange={(event) => event.target.value && reset(setDate)(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="type-label uppercase text-muted-foreground">Search</span>
          <Input
            type="search"
            value={search}
            aria-label="Search orders"
            placeholder="Order number or outlet"
            className="w-[260px]"
            onChange={(event) => reset(setSearch)(event.target.value)}
          />
        </label>
        <span className="flex-1" />
        <p className="type-body-small m-0 text-muted-foreground">
          {total} {total === 1 ? 'order' : 'orders'} to plan
        </p>
      </div>

      {orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : orders.isPending ? (
        <Skeleton className="h-[420px] w-full" />
      ) : list.length === 0 ? (
        <EmptyState
          title="Nothing to plan for this day"
          description={
            search.trim()
              ? 'No order on this day matches that search.'
              : 'Orders show here once stores send them, and stay until a plan picks them up.'
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            {groupOf(list).map((group) => (
              <TableBody key={`${group.districtId}#${group.brand}`}>
                <TableRow>
                  <TableHead colSpan={8} className="bg-page">
                    {districtLabel(group.districtId)} · {brandWord(group.brand)}
                    <span className="type-body-small ml-2 font-normal normal-case text-muted-foreground">
                      {group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'}
                    </span>
                  </TableHead>
                </TableRow>
                {group.orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono font-bold">{order.orderNo}</TableCell>
                    <TableCell>
                      <TableCellStack primary={order.outlet.name} secondary={order.outlet.id} />
                    </TableCell>
                    <TableCell>{classLabel(order.tempClass)}</TableCell>
                    <TableCell className="text-right">{order.totals.units}</TableCell>
                    <TableCell className="text-right">{kg(order.totals.weightKg)} kg</TableCell>
                    <TableCell>{deliveryLabel(order.deliveryDate, order.deliveryWindow)}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusChip tone={TONE_OF[order.status] ?? 'neutral'}>{order.status}</StatusChip>
                        {order.urgent ? <StatusChip tone="danger">Urgent</StatusChip> : null}
                        {order.afterCutoff ? <StatusChip tone="muted">After cutoff</StatusChip> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center justify-end gap-2">
                        {getLink(order._links, 'timeline') ? (
                          <Button variant="ghost" size="sm" onClick={() => setTimeline(order)}>
                            Timeline
                          </Button>
                        ) : null}
                        <Action
                          link={order._links.priority}
                          variant="outline"
                          size="sm"
                          onAction={() =>
                            priority
                              .mutateAsync({
                                id: order.id,
                                data: { urgent: !order.urgent },
                                headers: { 'If-Match': `W/"${order.version}"` },
                              })
                              .then(refresh)
                          }
                        />
                        <Action
                          link={order._links.cancel}
                          variant="outline"
                          size="sm"
                          onAction={() => setCancelling(order)}
                        />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ))}
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

      {priority.isError ? <ErrorState error={priority.error} /> : null}

      {cancelling ? (
        <CancelOrderDialog
          order={cancelling}
          onCancelled={refresh}
          onClose={() => setCancelling(null)}
        />
      ) : null}
      {timeline ? <OrderTimelineDialog orderId={timeline.id} orderNo={timeline.orderNo} onClose={() => setTimeline(null)} /> : null}
    </div>
  )
}
