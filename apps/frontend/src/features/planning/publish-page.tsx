// Figma: 17 Review and publish · 185:16544, step 4 of planning (18 Publish plan is publish-dialog.tsx).
import { usePlanBuildingPublishPreview, type PublishBlockerDto, type TripDto, type UnplannedOrderDto } from '@compass/api-client'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { formatColombo } from '@/lib/format-colombo'
import { cn } from '@/lib/cn'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { PlanStepper } from './plan-chrome'
import { BRAND_GLYPH, BRAND_WORD, CHECKS, dayLabel } from './plan-copy'
import { PublishDialog } from './publish-dialog'
import { usePlanStep } from './use-plan-step'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const deferredOf = (unplanned: readonly UnplannedOrderDto[]) => unplanned.filter((o) => o.deferralStatus === 'CONFIRMED')

/**
 * 17: the day as it will go out. Publish appears only when the plan's preview carries the `publish`
 * link (open, nothing blocking, AC-PLN-03, 20); until then the blockers are listed next to what
 * they are about, or the time publishing opens.
 */
export function PublishPage() {
  const step = usePlanStep()
  const navigate = useNavigate()
  const { date, day, plan, trips, unplanned } = step
  const preview = usePlanBuildingPublishPreview(plan?.id ?? '', { query: { enabled: Boolean(plan) } })
  const [confirming, setConfirming] = useState(false)
  const view = preview.data?.data
  const deferred = deferredOf(unplanned)
  const undecided = plan?.summary.undecided ?? 0
  usePageHeader({
    eyebrow: `PLAN · ${dayLabel(date).toUpperCase()} · ${undecided ? `${plural(undecided, 'ORDER')} UNDECIDED` : 'ALL ORDERS DECIDED'}`,
    title: 'Review and publish',
  })

  const vehicles = new Set(trips.map((t) => t.vehicleId)).size
  const failing = new Set<string>(trips.flatMap((t) => t.violations.filter((v) => v.severity === 'HARD').map((v) => v.rule)))
  const passing = CHECKS.filter((c) => !c.rules.some((r) => failing.has(r))).length
  const served = plan?.summary.plannedOrders ?? 0
  const total = served + unplanned.length
  const second = deferred.filter((o) => o.repeatSkip).length
  const firstOut = [...trips].map((t) => t.plannedDepartAt).filter((at): at is string => Boolean(at)).sort()[0]

  return (
    <div className="-mx-6 -mb-4 -mt-4 flex min-h-0 flex-1 flex-col">
      {view ? (
        <HeaderActions>
          <Action link={view._links.publish} variant="primary" onAction={() => setConfirming(true)}>
            Publish plan
          </Action>
        </HeaderActions>
      ) : null}
      <PlanStepper step={4} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-page px-6 py-4">
        {day.plan.isError || preview.isError ? (
          <ErrorState error={day.plan.error ?? preview.error} onRetry={() => void Promise.all([day.plan.refetch(), preview.refetch()])} />
        ) : !plan || day.isPending || !view ? (
          <Skeleton className="h-[640px] w-full" />
        ) : (
          <>
            <Banner blockers={view.blockers} open={view.open} opensAt={view.opensAt} deferred={deferred} unplanned={unplanned.length} />

            <div className="grid grid-cols-4 gap-4">
              <Stat label="Orders served" value={String(served)} caption={`of ${total} confirmed`} />
              <Stat label="Deferred" value={String(deferred.length)} caption={plural(second, 'second deferral')} danger={deferred.length > 0} />
              <Stat label="Trips" value={String(trips.length)} caption={`on ${plural(vehicles, 'vehicle')}`} />
              <Stat label="Checks passing" value={`${passing} / ${CHECKS.length}`} caption="weight, volume, condition, access, windows, fuel" />
            </div>

            <div className="flex items-start gap-4">
              <section aria-label="Deferred orders" className="min-w-px flex-1 rounded-lg border border-border bg-background">
                <h2 className="type-section m-0 border-b border-border px-4 py-3 text-foreground">Deferred orders · reasons on record</h2>
                {deferred.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Outlet</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>History</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deferred.map((o) => (
                        <TableRow key={o.orderId}>
                          <TableCell>
                            <OutletCell order={o} />
                          </TableCell>
                          <TableCell className="type-body">{o.reasonLabel ?? o.reasonCode}</TableCell>
                          <TableCell>
                            <StatusChip tone={o.repeatSkip ? 'danger' : 'neutral'}>{o.repeatSkip ? '2 of 2 runs' : 'First deferral'}</StatusChip>
                          </TableCell>
                          <TableCell className="type-body max-w-[220px] truncate">{o.note ?? '—'}</TableCell>
                          <TableCell>
                            <StatusChip tone="neutral">Deferred</StatusChip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="type-body m-0 px-4 py-6 text-muted-foreground">Every order is on a trip. Nothing is deferred.</p>
                )}
              </section>

              <div className="flex w-[378px] shrink-0 flex-col gap-4">
                <section aria-label="Trips going out" className="rounded-lg border border-border bg-background">
                  <header className="border-b border-border px-4 py-3">
                    <h2 className="type-section m-0 text-foreground">Trips going out</h2>
                    <p className="type-body-small m-0 text-muted-foreground">
                      {plural(trips.length, 'trip')} · {plural(trips.reduce((n, t) => n + t.stops.length, 0), 'stop')}
                      {firstOut ? ` · first departure ${formatColombo(new Date(firstOut), 'HH:mm')}` : ''}
                    </p>
                  </header>
                  <ul className="m-0 list-none p-0">
                    {trips.map((t) => (
                      <TripRow key={t.id} trip={t} />
                    ))}
                  </ul>
                </section>

                <section aria-label="When you publish" className="rounded-lg border border-border bg-background">
                  <h2 className="type-section m-0 border-b border-border px-4 py-3 text-foreground">When you publish</h2>
                  <dl className="m-0 flex flex-col">
                    <Notify who="Loaders" what={`Loading lists at ${step.depotName} dock (${view.notify.loaders})`} />
                    <Notify who="Drivers" what={`Trips on phones once loading starts (${view.notify.drivers})`} />
                    <Notify who="Stores" what={`Orders show as Planned, with ETA (${view.notify.stores})`} />
                    <Notify who="Deferred stores" what="Told why, with the new date" />
                  </dl>
                </section>
              </div>
            </div>
          </>
        )}
      </div>

      {confirming && plan && view ? (
        <PublishDialog
          plan={plan}
          dayText={dayLabel(date)}
          depotName={step.depotName}
          deferred={deferred}
          onClose={() => setConfirming(false)}
          onPublished={async () => {
            await Promise.all([day.refresh(), preview.refetch()])
            void navigate(`/dispatch/plan/${date}`)
          }}
        />
      ) : null}
    </div>
  )
}

interface BannerProps {
  blockers: readonly PublishBlockerDto[]
  open: boolean
  opensAt: string
  deferred: readonly UnplannedOrderDto[]
  unplanned: number
}

/** What stands between the plan and Publish, or the sign that nothing does. */
function Banner({ blockers, open, opensAt, deferred, unplanned }: BannerProps) {
  const navigate = useNavigate()
  if (blockers.length) {
    return (
      <section aria-label="Blockers" className="flex flex-col gap-2 rounded-lg border border-status-danger-border bg-status-danger-bg px-4 py-3.5">
        <h2 className="type-card-title m-0 text-status-danger-fg">{plural(blockers.length, 'blocker')} left</h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {blockers.map((b, i) => (
            <li key={`${b.kind}:${b.orderId ?? b.tripId ?? i}`} className="type-body flex items-center gap-2 text-foreground">
              <Icon name="close" size={14} className="text-status-danger-icon" />
              <span className="flex-1">{b.message}</span>
              {b.kind === 'UNDECIDED_ORDER' ? (
                <Button variant="link" size="sm" onClick={() => void navigate('../unplanned', { relative: 'path' })}>
                  Decide
                </Button>
              ) : b.kind === 'HARD_VIOLATION' || b.kind === 'NO_DRIVER' ? (
                <Button variant="link" size="sm" onClick={() => void navigate('..', { relative: 'path' })}>
                  Fix on the plan
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    )
  }
  const overridden = deferred.filter((o) => o.repeatSkip).length
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
      <h2 className="type-card-title m-0 text-foreground">
        {unplanned === 1 ? 'All 1 unplanned order has a decision' : `All ${unplanned} unplanned orders have a decision`}
      </h2>
      <p className="type-body m-0 text-foreground">
        {plural(deferred.length - overridden, 'deferred with a reason', 'deferred with a reason')}
        {overridden ? `, and ${plural(overridden, 'repeat skip')} overridden with a note` : ''}.{' '}
        {open ? 'Nothing is left unplanned.' : `Publishing opens at ${formatColombo(new Date(opensAt), 'HH:mm')}.`}
      </p>
    </section>
  )
}

function Stat({ label, value, caption, danger }: { label: string; value: string; caption: string; danger?: boolean }) {
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
      <span className="type-label uppercase text-muted-foreground">{label}</span>
      <span className={cn('font-sans text-[28px] font-bold leading-tight', danger ? 'text-status-danger-fg' : 'text-foreground')}>{value}</span>
      <span className="type-body-small text-muted-foreground">{caption}</span>
    </section>
  )
}

function OutletCell({ order }: { order: UnplannedOrderDto }) {
  const glyph = BRAND_GLYPH[order.brand] ?? BRAND_GLYPH.FRESH
  return (
    <span className="flex flex-col gap-px">
      <span className="flex items-center gap-1.5 font-sans text-[13px] font-bold text-foreground">
        <Icon name={glyph.icon} size={14} className={glyph.className} />
        {order.outletName}
      </span>
      <span className="type-mono-small text-muted-foreground">{order.orderNo}</span>
    </span>
  )
}

function TripRow({ trip }: { trip: TripDto }) {
  return (
    <li className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0">
      <span className="w-[64px] font-mono text-[12px] font-bold text-foreground">{trip.vehicleCode}</span>
      <span className="type-body flex-1 text-foreground">
        Trip {trip.tripNo} · {BRAND_WORD[trip.brand] ?? trip.brand} · {trip.districtName}
      </span>
      <span className="type-mono-small text-muted-foreground">{trip.stops.length} stops</span>
      <span className="w-[44px] text-right font-mono text-[12px] font-bold text-foreground">
        {trip.plannedDepartAt ? formatColombo(new Date(trip.plannedDepartAt), 'HH:mm') : '—'}
      </span>
    </li>
  )
}

function Notify({ who, what }: { who: string; what: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0">
      <dt className="type-body text-muted-foreground">{who}</dt>
      <dd className="type-body-medium m-0 text-right font-bold text-foreground">{what}</dd>
    </div>
  )
}
