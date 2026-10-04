// Figma: M3 Orders · 185:10924 (M4 Deferral notice opens over it).
import {
  useDeferralsList,
  useMeGet,
  useOrdersList,
  usePlansOrderEta,
  useReceivingRosterGet,
  type DeferralDto,
  type OrderDto,
} from '@compass/api-client'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { cn } from '@/lib/cn'
import { getLink } from '@/lib/links'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { serverNow } from '@/lib/server-clock'
import { Button } from '@/ui/button'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { OrderTimelineDialog } from '@/features/audit/order-timeline-dialog'
import { DeferralNotice } from '@/features/deferrals/deferral-notice'
import { brandWord } from './order-copy'
import { dayLabel } from './order-format'

/** Orders still on their way to the store: sent, planned, deferred, loaded, out, or delivered and not yet received. */
const ONGOING = 'SUBMITTED,CONFIRMED,PLANNED,DEFERRED,LOADED,IN_TRANSIT,DELIVERED,PARTIAL'

const STEPS = ['Submitted', 'Planned', 'Loaded', 'On the way', 'Delivered'] as const

/** How far along the five steps an order is, 0-based. */
const STEP_OF: Record<string, number> = {
  SUBMITTED: 0,
  CONFIRMED: 0,
  PLANNED: 1,
  LOADED: 2,
  IN_TRANSIT: 3,
  DELIVERED: 4,
  PARTIAL: 4,
}

/** On a trip and still to arrive: the statuses an ETA exists for. */
const EXPECTED = new Set(['PLANNED', 'LOADED', 'IN_TRANSIT'])

const kind = (o: OrderDto) => `${brandWord(o.brand)} · ${o.tempClass === 'CHILLED' ? 'Chilled' : 'Dry'}`

/**
 * M3: the outlet's orders on their way, each with where it has got to. A deferred order says
 * which run it moved to and why, and opens its notice (M4), where the store answers.
 */
export function OrdersPage() {
  const navigate = useNavigate()
  const orders = useOrdersList({ 'filter[status]': ONGOING, sort: 'deliveryDate', limit: 25 })
  const deferrals = useDeferralsList({ 'filter[status]': 'CONFIRMED', sort: '-createdAt', limit: 50 })
  const [notice, setNotice] = useState<string | null>(null)
  usePageHeader({ eyebrow: 'Orders', title: 'Orders' })

  // The newest deferral of each order is the one its card talks about.
  const deferralOf = new Map<string, DeferralDto>()
  for (const d of deferrals.data?.data ?? []) if (!deferralOf.has(d.orderId)) deferralOf.set(d.orderId, d)
  const list = orders.data?.data ?? []

  return (
    <div className="flex items-start gap-4">
      <HeaderActions>
        <SegmentedControl<'ongoing' | 'history'>
          aria-label="Orders"
          value="ongoing"
          onValueChange={(v) => v === 'history' && void navigate('/store/history')}
          options={[
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'history', label: 'History' },
          ]}
        />
      </HeaderActions>

      <div className="flex min-w-px flex-1 flex-col gap-3">
        {orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : orders.isPending ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[136px] w-full" />)
        ) : list.length === 0 ? (
          <EmptyState
            title="No orders on the way"
            description="Orders you send show here until you confirm their receipt."
            action={
              <Button variant="primary" onClick={() => void navigate('/store/orders/new')}>
                New order
              </Button>
            }
          />
        ) : (
          list.map((order) =>
            order.status === 'DEFERRED' ? (
              <DeferredCard key={order.id} order={order} deferral={deferralOf.get(order.id)} onOpen={setNotice} />
            ) : (
              <OrderCard key={order.id} order={order} />
            ),
          )
        )}
        <p className="type-body-small m-0 text-muted-foreground">You’ll get an alert if an ETA slips or an order is deferred.</p>
      </div>

      <RosterCard />
      {notice ? <DeferralNotice id={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  )
}

function OrderCard({ order }: { order: OrderDto }) {
  const navigate = useNavigate()
  const at = STEP_OF[order.status] ?? 0
  const [timeline, setTimeline] = useState(false)
  // The store's ETA, never the map (AC-EXE-22): planned until the trip leaves, then projected from now.
  const eta = usePlansOrderEta(order.id, { query: { enabled: EXPECTED.has(order.status), refetchInterval: 60_000 } }).data?.data
  const late = eta?.standing === 'LATE'
  return (
    <article aria-label={order.orderNo} className="flex flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3.5">
      <header className="flex items-start gap-2.5">
        <span className="font-mono text-[13px] font-bold text-foreground">#{order.orderNo}</span>
        <span className="type-card-title text-foreground">{kind(order)}</span>
        {order.status === 'IN_TRANSIT' ? (
          <StatusChip tone="neutral">Live</StatusChip>
        ) : order.tempClass === 'CHILLED' ? (
          <StatusChip tone="neutral">Chilled</StatusChip>
        ) : null}
        <span className="flex-1" />
        <span className="flex flex-col items-end">
          <span className="type-label uppercase text-muted-foreground">ETA</span>
          <span className={cn('font-mono text-[14px] font-bold', late ? 'text-destructive-foreground' : 'text-foreground')}>
            {eta?.etaAt ? formatColombo(eta.etaAt, 'HH:mm') : '–'}
          </span>
        </span>
      </header>
      <ol className="m-0 grid list-none grid-cols-5 gap-1 p-0">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-col gap-1.5">
            <span aria-hidden="true" className={cn('h-1 rounded-full', i <= at ? 'bg-primary' : 'bg-muted')} />
            <span
              aria-current={i === at ? 'step' : undefined}
              className={cn('type-body-small', i === at ? 'font-bold text-foreground' : 'text-muted-foreground')}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3">
        <p className="type-body-small m-0 text-muted-foreground">
          Window {dayLabel(order.deliveryDate)} · {order.deliveryWindow.open}–{order.deliveryWindow.close}
        </p>
        <span className="flex items-center gap-2">
          {getLink(order._links, 'timeline') ? (
            <Button variant="ghost" size="sm" onClick={() => setTimeline(true)}>
              Timeline
            </Button>
          ) : null}
          {order.status === 'DELIVERED' || order.status === 'PARTIAL' ? (
            <Button variant="default" size="sm" onClick={() => void navigate(`/store/orders/${order.id}/receipt`)}>
              Confirm receipt
            </Button>
          ) : null}
        </span>
      </div>
      {timeline ? <OrderTimelineDialog orderId={order.id} orderNo={order.orderNo} onClose={() => setTimeline(false)} /> : null}
    </article>
  )
}

function DeferredCard({ order, deferral, onOpen }: { order: OrderDto; deferral: DeferralDto | undefined; onOpen: (id: string) => void }) {
  return (
    <article
      aria-label={order.orderNo}
      className="flex items-center gap-3 rounded-lg border border-status-danger-border bg-status-danger-bg px-4 py-3.5"
    >
      <div className="flex min-w-px flex-1 flex-col gap-1">
        <p className="m-0 flex items-center gap-2.5">
          <span className="font-mono text-[13px] font-bold text-foreground">#{order.orderNo}</span>
          <span className="type-card-title text-foreground">{kind(order)}</span>
          <StatusChip tone="danger">Deferred</StatusChip>
        </p>
        <p className="type-body m-0 text-foreground">
          Moved to {dayLabel(order.deliveryDate)}
          {deferral ? ` · ${deferral.reasonLabel}` : ''}
        </p>
      </div>
      {deferral ? (
        <Button variant="default" onClick={() => onOpen(deferral.id)}>
          View notice
        </Button>
      ) : null}
    </article>
  )
}

/** Who takes deliveries today, from the outlet's receiving roster. */
function RosterCard() {
  const outletId = useMeGet().data?.data.outletId ?? ''
  const today = toColomboDate(serverNow())
  const roster = useReceivingRosterGet(outletId, { date: today }, { query: { enabled: outletId !== '' } })
  const entries = roster.data?.data.entries ?? []
  return (
    <section aria-label="Receiving roster" className="w-[360px] shrink-0 rounded-lg border border-border bg-background">
      <header className="border-b border-border px-4 py-3">
        <h2 className="type-section m-0 text-foreground">Receiving roster · today</h2>
        <p className="type-body-small m-0 text-muted-foreground">Staff on the dock for each delivery</p>
      </header>
      {roster.isPending && outletId ? (
        <Skeleton className="m-4 h-[120px]" />
      ) : entries.length === 0 ? (
        <p className="type-body-small m-0 px-4 py-3.5 text-muted-foreground">No one is on the roster for today yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-4 border-t border-slate-100 px-4 py-3 first:border-t-0">
              <span className="font-mono text-[13px] font-bold text-foreground">
                {e.from}–{e.to}
              </span>
              <span className="type-body text-foreground">{e.staffName}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
