// Figma: 21 End-of-day summary · 185:18295
import {
  getPlansEndOfDayQueryKey,
  getPlansForDayQueryKey,
  usePlanBuildingClose,
  usePlansEndOfDay,
  usePlansForDay,
  type EndOfDayDto,
} from '@compass/api-client'
import { instantAt } from '@waypoint/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { cn } from '@/lib/cn'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { useServerClock } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'

const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v)
const percentText = (n: number | null) => (n === null ? '—' : `${n}%`)

/**
 * 21: how the day went, trip by trip, what to follow up, and Close the day (AC-PLN-29). The button
 * comes from the summary's `close` link, which the server offers only when no trip is loading or on
 * the road and no sync conflict is open; closing defers every stop nobody served, records the
 * fuel and locks the plan. `?date=` shows another day; the default is today at the picked depot.
 */
export function EndOfDayPage() {
  const queryClient = useQueryClient()
  const { now } = useServerClock(60_000)
  const { depot } = useDepot()
  const [params] = useSearchParams()
  const asked = params.get('date')
  const date = isDate(asked) ? asked : toColomboDate(now)
  const plan = usePlansForDay(depot, date)
  const planId = plan.data?.data.id ?? ''
  const summary = usePlansEndOfDay(planId, { query: { enabled: planId !== '' } })
  const close = usePlanBuildingClose()
  const eod = summary.data?.data

  usePageHeader({
    eyebrow: `Tracking · ${formatColombo(instantAt(date, 720), 'EEE d MMM')} · ${formatColombo(now, 'HH:mm')}`,
    title: 'End-of-day summary',
  })

  const closeDay = async (headers: Record<string, string>) => {
    if (!planId) return
    await close.mutateAsync({ id: planId, headers: { 'If-Match': headers['If-Match'] ?? '', 'Idempotency-Key': headers['Idempotency-Key'] ?? '' } })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getPlansEndOfDayQueryKey(planId) }),
      queryClient.invalidateQueries({ queryKey: getPlansForDayQueryKey(depot, date) }),
    ])
    toast({ title: 'The day is closed', description: 'Unserved stops are deferred and the stores are told.', tone: 'success' })
  }

  const error = plan.error ?? summary.error
  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <Button variant="outline" disabled={!eod?.trips.length} onClick={() => eod && exportCsv(eod)}>
          Export
        </Button>
        {eod?.status === 'CLOSED' ? (
          <StatusChip tone="neutral">Closed{eod.closedAt ? ` ${formatColombo(eod.closedAt, 'HH:mm')}` : ''}</StatusChip>
        ) : (
          <Action
            link={eod?._links.close}
            variant="primary"
            version={plan.data?.data.version}
            confirm={{
              title: `Close ${formatColombo(instantAt(date, 720), 'EEE d MMM')}?`,
              description: eod?.totals.unserved
                ? `${eod.totals.unserved} stop${eod.totals.unserved === 1 ? '' : 's'} nobody reached and every failed stop become deferrals to the next run, and the stores are told. The plan then locks.`
                : 'Failed stops become deferrals to the next run, each finished trip’s fuel is recorded, and the plan locks.',
              confirmLabel: 'Close the day',
            }}
            onAction={({ headers }) => closeDay(headers)}
          >
            Close the day
          </Action>
        )}
      </HeaderActions>

      {plan.isError || summary.isError ? (
        <ErrorState error={error} onRetry={() => void (plan.isError ? plan.refetch() : summary.refetch())} />
      ) : !eod ? (
        <LoadingState />
      ) : eod.trips.length === 0 ? (
        <EmptyState title="No trips ran on this day" description="Once a plan is published and its trips run, their results show here." />
      ) : (
        <>
          {close.isError ? <ErrorState error={close.error} /> : null}
          <div className="grid grid-cols-5 gap-3">
            <Stat label="Stops delivered" value={String(eod.totals.delivered)} caption={`of ${eod.totals.stops} planned`} />
            <Stat label="Partial" value={String(eod.totals.partial)} caption="store told what’s short" />
            <Stat label="Failed" value={String(eod.totals.failed)} caption="re-planned for tomorrow" danger={eod.totals.failed > 0} />
            <Stat label="On time" value={percentText(eod.totals.onTimePct)} caption="inside the delivery window" />
            <Stat label="Deferred" value={String(eod.totals.deferred)} caption="logged with reasons" />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-4">
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead className="text-right">Stops</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Partial</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead>Sync</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eod.trips.map((t) => (
                    <TableRow key={t.tripId} className="h-[47px]">
                      <TableCell className="font-mono text-[12px] font-bold">
                        {t.vehicleCode}
                        {t.tripNo > 1 ? ` · ${t.tripNo}` : ''}
                      </TableCell>
                      <TableCell className="type-body">{t.driverName ?? '—'}</TableCell>
                      <Num>{t.stops}</Num>
                      <Num>{t.delivered}</Num>
                      <Num>{t.partial}</Num>
                      <Num className={t.failed > 0 ? 'font-bold text-destructive-foreground' : undefined}>{t.failed}</Num>
                      <Num>{percentText(t.onTimePct)}</Num>
                      <TableCell>
                        {t.openConflicts > 0 ? (
                          <StatusChip tone="danger">{t.openConflicts} to resolve</StatusChip>
                        ) : t.status === 'COMPLETED' ? (
                          <StatusChip tone="neutral">Synced</StatusChip>
                        ) : (
                          <StatusChip tone="info">{t.status === 'IN_PROGRESS' ? 'On the road' : t.status.toLowerCase()}</StatusChip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <FollowUp eod={eod} />
          </div>
        </>
      )}
    </div>
  )
}

function FollowUp({ eod }: { eod: EndOfDayDto }) {
  return (
    <aside aria-label="Follow up" className="flex flex-col rounded-lg border border-border bg-background">
      <header className="flex items-start justify-between border-b border-border px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="type-card-title m-0 text-foreground">Follow up</h2>
          <p className="type-body-small m-0 text-muted-foreground">Open before you close the day</p>
        </div>
        <span className="font-mono text-[12px] text-muted-foreground">{eod.followUps.length}</span>
      </header>
      {eod.closeBlockers.length && eod.status === 'PUBLISHED' ? (
        <section aria-label="Before you can close" className="flex flex-col gap-1 border-b border-status-warning-border bg-status-warning-bg px-4 py-3">
          <p className="type-label m-0 uppercase text-status-warning-fg">Before you can close</p>
          {eod.closeBlockers.map((b) => (
            <p key={b} className="type-body-small m-0 text-foreground">
              {b}
            </p>
          ))}
        </section>
      ) : null}
      {eod.followUps.length === 0 ? (
        <p className="type-body m-0 px-4 py-4 text-muted-foreground">Nothing to follow up.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {eod.followUps.map((f, i) => (
            <li key={`${f.kind}-${f.orderId ?? f.tripId ?? i}`} className="flex flex-col gap-0.5 border-b border-border px-4 py-3 last:border-b-0">
              <span className="type-body-medium font-bold text-foreground">{f.title}</span>
              <span className="type-body-small text-muted-foreground">{f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <TableCell className={cn('text-right font-mono text-[12px]', className)}>{children}</TableCell>
}

function Stat({ label, value, caption, danger }: { label: string; value: string; caption: string; danger?: boolean }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
      <span className="type-label uppercase text-muted-foreground">{label}</span>
      <span className={cn('font-sans text-[28px] font-bold leading-tight', danger ? 'text-destructive-foreground' : 'text-foreground')}>{value}</span>
      <span className="type-body-small text-muted-foreground">{caption}</span>
    </section>
  )
}

function LoadingState() {
  return (
    <div aria-label="Loading the day" className="flex flex-col gap-4">
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[102px] rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4">
        <Skeleton className="h-[370px] rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    </div>
  )
}

/** The table as CSV, one row per trip. */
function exportCsv(eod: EndOfDayDto) {
  const rows = [
    ['vehicle', 'trip', 'driver', 'stops', 'delivered', 'partial', 'failed', 'on_time_pct', 'open_conflicts'],
    ...eod.trips.map((t) => [t.vehicleCode, t.tripNo, t.driverName ?? '', t.stops, t.delivered, t.partial, t.failed, t.onTimePct ?? '', t.openConflicts]),
  ]
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `end-of-day-${eod.depotId}-${eod.date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
