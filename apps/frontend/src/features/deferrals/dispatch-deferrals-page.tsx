// Figma: 23 Deferrals · 185:18890, the dispatcher's deferral log (ROO-43).
import {
  useDeferralReasonsList,
  useDeferralsList,
  useOrdersList,
  type DeferralDto,
  type DeferralsListParams,
  type OrdersListParams,
} from '@compass/api-client'
import { addDays, instantAt } from '@waypoint/shared'
import { useEffect, useState } from 'react'
import { useDepot } from '@/app/layouts/depot-context'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { cn } from '@/lib/cn'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { useServerClock } from '@/lib/server-clock'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { SegmentedControl } from '@/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'
import { BRAND_GLYPH } from '@/features/planning/plan-copy'
import { PERIODS, STORE_CHIP, placeName, shortName, type Period } from './deferral-copy'
import { DeferralPanel } from './deferral-panel'
import { deferralsCsv, download } from './deferrals-export'

type Tab = 'all' | 'awaiting' | 'priority' | 'repeat'

/** The list filters, plus the operator filters the generated params type does not spell out. */
type Filters = DeferralsListParams & { 'filter[fromDate][gte]'?: string }

const TAB_FILTER: Record<Tab, Filters> = {
  all: {},
  awaiting: { 'filter[storeResponse]': 'AWAITING' },
  priority: { 'filter[storeResponse]': 'PRIORITY_REQUESTED' },
  repeat: { 'filter[repeatSkip]': 'true' },
}

const ALL_REASONS = 'all'

/**
 * How many deferrals match, from a one-row page's meta (the tab counts and the stat cards):
 * undefined while loading, null when the count could not load.
 */
const useTotal = (filters: Filters): number | null | undefined => {
  const q = useDeferralsList({ ...filters, limit: 1 })
  return q.isError ? null : q.data?.meta.page.total
}

/** "Tue 29" in the Moved column. */
const shortDay = (date: string) => formatColombo(instantAt(date, 720), 'EEE d')

/**
 * 23: every deferral in the period, newest first. The dispatcher sees why each order moved, how
 * often its outlet has been skipped, and what the store said; a row opens its panel, where the
 * order can be pinned to the next run and the store answered (AC-PLN-35, AC-PLN-36). Every action
 * comes from the deferral's or the order's links.
 */
export function DispatchDeferralsPage() {
  const { now } = useServerClock(60_000)
  const { depot } = useDepot()
  const today = toColomboDate(now)
  const [period, setPeriod] = useState<Period>(14)
  const [reason, setReason] = useState(ALL_REASONS)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [paging, setPaging] = useState({ limit: 10, offset: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Search as the dispatcher types, once they pause.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPaging((p) => ({ ...p, offset: 0 }))
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const since = addDays(today, -period)
  const base: Filters = {
    'filter[depotId]': depot,
    'filter[fromDate][gte]': since,
    ...(reason === ALL_REASONS ? {} : { 'filter[reasonCode]': reason }),
  }
  const filters: Filters = { ...base, ...TAB_FILTER[tab], ...(q ? { q } : {}), sort: '-createdAt' }
  const list = useDeferralsList({ ...filters, ...paging })
  const counts: Record<Tab, number | null | undefined> = {
    all: useTotal({ ...base, ...TAB_FILTER.all }),
    awaiting: useTotal({ ...base, ...TAB_FILTER.awaiting }),
    priority: useTotal({ ...base, ...TAB_FILTER.priority }),
    repeat: useTotal({ ...base, ...TAB_FILTER.repeat }),
  }
  const ordersParams: OrdersListParams & { 'filter[deliveryDate][gte]'?: string } = {
    'filter[depotId]': depot,
    'filter[deliveryDate][gte]': since,
    limit: 1,
  }
  const ordersInPeriod = useOrdersList(ordersParams).data?.meta.page.total
  const reasons = useDeferralReasonsList().data?.data ?? []

  const rows = list.data?.data ?? []
  const page = list.data?.meta.page
  const current = rows.find((d) => d.id === selected) ?? rows[0]

  usePageHeader({ eyebrow: `Deferrals · Last ${period} days`, title: 'Deferrals' })

  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPaging((p) => ({ ...p, offset: 0 }))
    setSelected(null)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      download(await deferralsCsv(filters), `deferrals-${since}-to-${today}.csv`)
    } catch {
      toast({ title: 'The export failed', description: 'Try again in a moment.', tone: 'danger' })
    } finally {
      setExporting(false)
    }
  }

  const share = typeof counts.all === 'number' && ordersInPeriod ? ((counts.all / ordersInPeriod) * 100).toFixed(1) : null

  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <Select value={String(period)} onValueChange={(v) => pick(setPeriod)(Number(v) as Period)}>
          <SelectTrigger aria-label="Period" className="w-auto gap-2">
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
        <Select value={reason} onValueChange={pick(setReason)}>
          <SelectTrigger aria-label="Reason" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_REASONS}>All reasons</SelectItem>
            {reasons.map((r) => (
              <SelectItem key={r.code} value={r.code}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" loading={exporting} disabled={!counts.all} onClick={() => void exportCsv()}>
          Export
        </Button>
      </HeaderActions>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Deferred"
              value={counts.all}
              caption={share !== null && ordersInPeriod ? `of ${ordersInPeriod.toLocaleString('en-US')} orders · ${share}%` : 'orders moved to a later run'}
            />
            <Stat label="Repeat skips" value={counts.repeat} caption="same outlet, back-to-back runs" danger />
            <Stat label="Priority requests" value={counts.priority} caption="waiting on you" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <SegmentedControl
              aria-label="Show"
              value={tab}
              onValueChange={pick(setTab)}
              options={[
                { value: 'all', label: 'All', count: counts.all ?? undefined },
                { value: 'awaiting', label: 'Awaiting', count: counts.awaiting ?? undefined },
                { value: 'priority', label: 'Priority', count: counts.priority ?? undefined },
                { value: 'repeat', label: 'Repeat', count: counts.repeat ?? undefined },
              ]}
            />
            <Input
              aria-label="Search outlet"
              placeholder="Search outlet"
              size="sm"
              className="w-[260px]"
              leading={<Icon name="search" size={16} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              title={q || tab !== 'all' || reason !== ALL_REASONS ? 'No deferrals match' : 'No deferrals in this period'}
              description={
                q || tab !== 'all' || reason !== ALL_REASONS
                  ? 'Try another outlet, reason or tab.'
                  : `Every order in the last ${period} days went on its run.`
              }
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Moved</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Skips 30d</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Logged by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <DeferralRow key={d.id} d={d} selected={d.id === current?.id} onSelect={() => setSelected(d.id)} />
                  ))}
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

        {current ? <DeferralPanel deferral={current} /> : list.isPending ? <Skeleton className="h-[472px] w-full rounded-lg" /> : null}
      </div>
    </div>
  )
}

function DeferralRow({ d, selected, onSelect }: { d: DeferralDto; selected: boolean; onSelect: () => void }) {
  const glyph = BRAND_GLYPH[d.outletBrand]
  const store = STORE_CHIP[d.storeResponse] ?? { label: d.storeResponse, tone: 'neutral' as const }
  const skips = d.skips30d ?? 0
  return (
    <TableRow
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={cn('h-[47px] cursor-pointer', selected && 'bg-accent shadow-[inset_3px_0_0_var(--color-primary)]')}
    >
      <TableCell className="font-mono text-[12px] font-bold">{d.orderNo}</TableCell>
      <TableCell>
        <span className="type-body-medium flex items-center gap-2 text-foreground">
          {glyph ? <Icon name={glyph.icon} size={14} className={glyph.className} /> : null}
          {placeName(d.outletName)}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-[12px]">
        {shortDay(d.fromDate)} → {shortDay(d.toDate)}
      </TableCell>
      <TableCell className="type-body max-w-[120px]">{d.reasonLabel}</TableCell>
      <TableCell className={cn('font-mono text-[12px]', skips >= 2 ? 'font-bold text-destructive-foreground' : 'text-slate-600')}>×{skips}</TableCell>
      <TableCell>
        <StatusChip tone={store.tone}>{store.label}</StatusChip>
      </TableCell>
      <TableCell className="type-body text-slate-600">{shortName(d.decidedByName)}</TableCell>
    </TableRow>
  )
}

function Stat({ label, value, caption, danger }: { label: string; value: number | null | undefined; caption: string; danger?: boolean }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
      <span className="type-label uppercase text-muted-foreground">{label}</span>
      {value === undefined ? (
        <Skeleton className="h-[34px] w-12" />
      ) : value === null ? (
        <span className="font-sans text-[28px] font-bold leading-tight text-muted-foreground">—</span>
      ) : (
        <span className={cn('font-sans text-[28px] font-bold leading-tight', danger && value > 0 ? 'text-destructive-foreground' : 'text-foreground')}>
          {value.toLocaleString('en-US')}
        </span>
      )}
      <span className="type-body-small text-muted-foreground">{caption}</span>
    </section>
  )
}

function TableSkeleton() {
  return (
    <div aria-label="Loading deferrals" className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
      <Skeleton className="h-[38px] rounded-none" />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-[47px] rounded-none bg-background" />
      ))}
    </div>
  )
}
