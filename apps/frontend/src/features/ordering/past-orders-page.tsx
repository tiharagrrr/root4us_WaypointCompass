// Figma: 04 Past orders · 488:8916
import { useDeferralsList, useOrdersList, type OrderDto, type OrdersListParams } from '@compass/api-client'
import { addDays } from '@waypoint/shared'
import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { useServerClock } from '@/lib/server-clock'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip, type StatusTone } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'
import { OrderTimelineDialog } from '@/features/audit/order-timeline-dialog'
import { placeName } from '@/features/deferrals/deferral-copy'
import { download } from '@/features/deferrals/deferrals-export'
import { BRAND_GLYPH } from '@/features/planning/plan-copy'
import { districtLabel } from './order-copy'
import { dayLabel, kg } from './order-format'
import { pastOrdersCsv } from './past-orders-export'

type Tab = 'all' | 'delivered' | 'partial' | 'failed'

/** Everything a store sent for the day; a draft never reached the dispatcher. */
const SENT = 'SUBMITTED,CONFIRMED,PLANNED,DEFERRED,LOADED,IN_TRANSIT,DELIVERED,PARTIAL,FAILED,RECEIVED,ISSUE_REPORTED,CANCELLED'

/** A store's receipt, or the issue it raised afterwards, still counts as the driver's delivery. */
const TAB_STATUS: Record<Tab, string> = {
  all: SENT,
  delivered: 'DELIVERED,RECEIVED,ISSUE_REPORTED',
  partial: 'PARTIAL',
  failed: 'FAILED',
}

/** The Result chip: the frame draws DELIVERED and PARTIAL neutral, DEFERRED and FAILED red. */
const RESULT: Record<string, { word: string; tone: StatusTone }> = {
  DELIVERED: { word: 'DELIVERED', tone: 'neutral' },
  RECEIVED: { word: 'DELIVERED', tone: 'neutral' },
  ISSUE_REPORTED: { word: 'ISSUE', tone: 'danger' },
  PARTIAL: { word: 'PARTIAL', tone: 'neutral' },
  DEFERRED: { word: 'DEFERRED', tone: 'danger' },
  FAILED: { word: 'FAILED', tone: 'danger' },
  CANCELLED: { word: 'CANCELLED', tone: 'muted' },
}

const DAY_MS = 24 * 60 * 60 * 1000

/** "yesterday", "2 days ago": how far back the day is from the depot's today. */
const agoLabel = (date: string, today: string): string => {
  const days = Math.round((Date.parse(today) - Date.parse(date)) / DAY_MS)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** How many orders match, from a one-row page's meta: undefined while loading, null on a failure. */
const useTotal = (filters: OrdersListParams): number | null | undefined => {
  const q = useOrdersList({ ...filters, limit: 1 })
  return q.isError ? null : q.data?.meta.page.total
}

const count = (value: number | null | undefined): string => (typeof value === 'number' ? value.toLocaleString('en-US') : '—')

/**
 * 04: one past run's orders and how each ended, read only. The dispatcher steps back a day at a
 * time, searches by order number or outlet (AC-ORD-31) and opens an order's timeline from its
 * link. Orders the day deferred have left this run — their delivery date is the later one — so
 * they are counted and listed from the deferral log beside the table.
 */
export function PastOrdersPage() {
  const navigate = useNavigate()
  const { depot } = useDepot()
  const { now } = useServerClock(60_000)
  const today = toColomboDate(now)
  const yesterday = addDays(today, -1)
  const [picked, setPicked] = useState<string | null>(null)
  const date = picked ?? yesterday
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [paging, setPaging] = useState({ limit: 10, offset: 0 })
  const [timeline, setTimeline] = useState<OrderDto | null>(null)
  const [exporting, setExporting] = useState(false)
  usePageHeader({ eyebrow: 'Order queue · past run', title: `Orders · ${dayLabel(date)}` })

  const day: OrdersListParams = { 'filter[depotId]': depot, 'filter[deliveryDate]': date }
  const filters: OrdersListParams = {
    ...day,
    'filter[status]': TAB_STATUS[tab],
    ...(search.trim() ? { q: search.trim() } : {}),
    sort: 'districtId,orderNo',
  }
  const orders = useOrdersList({ ...filters, ...paging })
  const totals: Record<Tab, number | null | undefined> = {
    all: useTotal({ ...day, 'filter[status]': TAB_STATUS.all }),
    delivered: useTotal({ ...day, 'filter[status]': TAB_STATUS.delivered }),
    partial: useTotal({ ...day, 'filter[status]': TAB_STATUS.partial }),
    failed: useTotal({ ...day, 'filter[status]': TAB_STATUS.failed }),
  }
  const moved = useDeferralsList({ 'filter[depotId]': depot, 'filter[fromDate]': date, sort: '-createdAt', limit: 3 })

  const list = orders.data?.data ?? []
  const page = orders.data?.meta.page
  const filtered = search.trim() !== '' || tab !== 'all'

  /** Another day, tab or search starts at the first page again. */
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setPaging((p) => ({ ...p, offset: 0 }))
    }
  const goTo = reset(setPicked)

  const exportCsv = async () => {
    setExporting(true)
    try {
      download(await pastOrdersCsv({ ...day, 'filter[status]': SENT, sort: 'districtId,orderNo' }), `orders-${date}.csv`)
    } catch {
      toast({ title: 'The export failed', description: 'Try again in a moment.', tone: 'danger' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <SegmentedControl<'queue' | 'past'>
          aria-label="Orders"
          value="past"
          onValueChange={(v) => v === 'queue' && void navigate('/dispatch/orders')}
          options={[
            { value: 'queue', label: 'Queue' },
            { value: 'past', label: 'Past runs' },
          ]}
        />
        <StatusChip tone="neutral">Read only</StatusChip>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => goTo(addDays(date, -1))}>
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </Button>
          <Input
            type="date"
            value={date}
            max={yesterday}
            aria-label="Delivery day"
            className="w-[168px]"
            onChange={(event) => event.target.value && event.target.value <= yesterday && goTo(event.target.value)}
          />
          <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= yesterday} onClick={() => goTo(addDays(date, 1))}>
            <Icon name="chevron-right" size={18} />
          </Button>
        </div>
        <Button variant="outline" loading={exporting} disabled={!totals.all} onClick={() => void exportCsv()}>
          Export
        </Button>
      </HeaderActions>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              aria-label="Result"
              value={tab}
              onValueChange={reset(setTab)}
              options={[
                { value: 'all', label: 'All', count: totals.all ?? undefined },
                { value: 'delivered', label: 'Delivered', count: totals.delivered ?? undefined },
                { value: 'partial', label: 'Partial', count: totals.partial ?? undefined },
                { value: 'failed', label: 'Failed', count: totals.failed ?? undefined },
              ]}
            />
            <Input
              type="search"
              aria-label="Search order or outlet"
              placeholder="Search order or outlet"
              size="sm"
              className="w-[220px]"
              leading={<Icon name="search" size={16} />}
              value={search}
              onChange={(event) => reset(setSearch)(event.target.value)}
            />
          </div>

          {orders.isError ? (
            <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
          ) : orders.isPending ? (
            <TableSkeleton />
          ) : list.length === 0 ? (
            <EmptyState
              title={filtered ? 'No orders match' : 'No orders on this day'}
              description={filtered ? 'Try another order number, outlet or result.' : `No store sent an order for ${dayLabel(date)}.`}
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>District</TableHead>
                    <TableHead className="text-right">kg</TableHead>
                    <TableHead className="text-right">m³</TableHead>
                    <TableHead>Temp</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((order) => {
                    const glyph = BRAND_GLYPH[order.brand]
                    const result = RESULT[order.status] ?? { word: order.status, tone: 'neutral' as const }
                    return (
                      <TableRow key={order.id} className="h-[45px]">
                        <TableCell className="font-mono text-[12px] font-bold text-foreground">{order.orderNo}</TableCell>
                        <TableCell>
                          <span className="type-body-medium flex items-center gap-2 text-foreground">
                            {glyph ? <Icon name={glyph.icon} size={14} className={glyph.className} /> : null}
                            {placeName(order.outlet.name)}
                          </span>
                        </TableCell>
                        <TableCell>{districtLabel(order.districtId)}</TableCell>
                        <TableCell className="text-right font-mono text-[12px]">{kg(order.totals.weightKg)}</TableCell>
                        <TableCell className="text-right font-mono text-[12px]">{order.totals.volumeM3.toFixed(1)}</TableCell>
                        <TableCell>{order.tempClass === 'CHILLED' ? 'Chilled' : 'Ambient'}</TableCell>
                        <TableCell>
                          <StatusChip tone={result.tone}>{result.word}</StatusChip>
                        </TableCell>
                        <TableCell className="text-right">
                          {getLink(order._links, 'timeline') ? (
                            <Button variant="ghost" size="sm" onClick={() => setTimeline(order)}>
                              Timeline
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {page ? (
                <Pagination
                  page={page}
                  onOffsetChange={(offset) => setPaging((p) => ({ ...p, offset }))}
                  onLimitChange={(limit) => setPaging({ limit, offset: 0 })}
                />
              ) : null}
            </TableContainer>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <section aria-label={`${dayLabel(date)} results`} className="rounded-lg border border-border bg-background shadow-xs">
            <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3.5">
              <h2 className="type-card-title m-0 text-foreground">{dayLabel(date)} · results</h2>
              <p className="type-body-small m-0 text-muted-foreground">
                From drivers’ proof of delivery · {agoLabel(date, today)}
              </p>
            </header>
            <dl className="m-0 flex flex-col px-4 py-1">
              <ResultRow label="Orders" value={totals.all} />
              <ResultRow label="Delivered" value={totals.delivered} />
              <ResultRow label="Partial" value={totals.partial} />
              <ResultRow label="Deferred" value={moved.isError ? null : moved.data?.meta.page.total} />
              <ResultRow label="Failed" value={totals.failed} />
            </dl>
          </section>

          <section aria-label="Moved to a later run" className="rounded-lg border border-border bg-background shadow-xs">
            <header className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <h2 className="type-card-title m-0 text-foreground">Moved to a later run</h2>
              <span className="font-mono text-[12px] text-muted-foreground">{count(moved.isError ? null : moved.data?.meta.page.total)}</span>
            </header>
            {moved.isError ? (
              <ErrorState error={moved.error} onRetry={() => void moved.refetch()} />
            ) : moved.isPending ? (
              <div className="flex flex-col gap-2 px-4 py-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : moved.data.data.length === 0 ? (
              <p className="type-body-small m-0 px-4 py-3.5 text-muted-foreground">Every order for this day went on its run.</p>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col p-0">
                  {moved.data.data.map((d) => {
                    const glyph = BRAND_GLYPH[d.outletBrand]
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
                        <span className="type-body-medium flex min-w-0 items-center gap-2 text-foreground">
                          {glyph ? <Icon name={glyph.icon} size={14} className={glyph.className} /> : null}
                          <span className="truncate">{placeName(d.outletName)}</span>
                        </span>
                        <span className="type-body-small shrink-0 text-muted-foreground">{d.reasonLabel}</span>
                      </li>
                    )
                  })}
                </ul>
                <div className="px-4 py-3">
                  <RouterLink to="/dispatch/deferrals" className="type-body-medium text-primary no-underline hover:underline">
                    Open in Deferrals
                  </RouterLink>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {timeline ? <OrderTimelineDialog orderId={timeline.id} orderNo={timeline.orderNo} onClose={() => setTimeline(null)} /> : null}
    </div>
  )
}

function ResultRow({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between border-b border-slate-100 py-2.5 last:border-b-0">
      <dt className="type-body text-muted-foreground">{label}</dt>
      <dd className="type-body m-0 font-bold text-foreground">{value === undefined ? <Skeleton className="h-4 w-8" /> : count(value)}</dd>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div aria-label="Loading orders" className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
      <Skeleton className="h-[38px] rounded-none" />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-[45px] rounded-none bg-background" />
      ))}
    </div>
  )
}
