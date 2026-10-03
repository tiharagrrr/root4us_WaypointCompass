// Figma: L2 Loading list · 185:19377 (tablet 1194 × 834) and L2m-b Loading list · 254:1498
// (phone 390 × 844: no rail, a back button, the counter on its own row and the two actions side
// by side at the bottom)
import { useMeGet } from '@compass/api-client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { serverNow } from '@/lib/server-clock'
import { enqueue } from '@/offline'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { useCheckedBy } from './checked-by'
import { DockOfflineBanner } from './dock-offline-banner'
import { FlagItemDialog } from './flag-item-dialog'
import { FlagNotice } from './flag-notice'
import { LoadLineCard } from './load-line-card'
import { latestFlag, liveFlag, tempClassLabel } from './loading-copy'
import { PlanUpdatedBanner } from './plan-updated-banner'
import { usePlanUpdated } from './use-plan-updated'
import { RunsRail } from './runs-rail'
import { ScanItemField } from './scan-item-field'
import { useLoadList, type LoadLineView } from './use-load-list'

/**
 * L2, the dock's whole job: one trip's load list in reverse stop order, last stop first, so the
 * first stop's goods go in last and come out first (AC-LOD-01).
 *
 * Every tick, undo and flag goes through the outbox, never straight to the API, so the list works
 * the same behind a parked reefer as it does beside the office (architecture rule 10). Release is
 * the one thing that needs a connection, and it lives on L4.
 */
export function LoadListPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const me = useMeGet()
  const checkedBy = useCheckedBy()
  const [flagging, setFlagging] = useState<LoadLineView | null>(null)
  const [cleared, setCleared] = useState<string | null>(null)
  const { list, stops, checked, total, isPending, isError, error, refetch } = useLoadList(id)
  const planUpdated = usePlanUpdated(id, list?.listRevision, list?.upToDate)
  // Nothing is tickable while the banner is up: she acknowledges the new list before she checks
  // another line (AC-LOD-13).
  const frozen = planUpdated.at !== null

  const check = (line: LoadLineView) => {
    checkedBy.withName((checkedByName) => {
      void enqueue({ kind: 'loader', type: 'LOAD_LINE_CHECKED', tripId: id, loadLineId: line.id, qtyLoaded: line.qtyExpected, checkedByName })
    })
  }
  const undo = (line: LoadLineView) => {
    checkedBy.withName((checkedByName) => {
      void enqueue({ kind: 'loader', type: 'LOAD_CHECK_UNDONE', tripId: id, loadLineId: line.id, checkedByName })
    })
  }

  const recheck = (flag: Parameters<typeof liveFlag>[0][number], line: LoadLineView | undefined) => {
    checkedBy.withName((checkedByName) => {
      void enqueue({
        kind: 'loader',
        type: 'LOAD_RECHECKED',
        tripId: id,
        loadFlagId: flag.id,
        loadLineId: line?.id,
        qtyLoaded: line?.qtyExpected,
        checkedByName,
      })
    })
  }

  const trip = list?.trip
  const depotId = trip?.depotId ?? me.data?.data.depotId ?? undefined
  const date = trip?.date ?? toColomboDate(serverNow())
  const lines = stops.flatMap((stop) => stop.lines)
  const flaggable = lines.find((line) => getLink(line._links, 'flag'))
  // The dock deals with one flag at a time: the newest unresolved one is what the banner is about,
  // and when there is none, the one just cleared says so until she acknowledges it (L3c).
  const open = lines.flatMap((line) => {
    const flag = liveFlag(line.flags)
    return flag ? [{ flag, line }] : []
  })
  const settled = lines.flatMap((line) => {
    const flag = latestFlag(line.flags)
    return flag && flag.status === 'RESOLVED' && flag.resolvedAt ? [{ flag, line }] : []
  })
  const blocking = open[open.length - 1] ?? (cleared === settled[settled.length - 1]?.flag.id ? undefined : settled[settled.length - 1])
  const awaiting = open.filter(({ flag }) => flag.status === 'AWAITING_RECHECK' || flag.decision)
  const blocked = (list?.releaseChecks ?? []).some((check) => !check.pass)

  return (
    <div data-slot="load-list" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 pb-3">
        <DockOfflineBanner />
        {blocking ? (
          <FlagNotice
            tripId={id}
            flag={blocking.flag}
            line={blocking.line}
            onRecheck={recheck}
            onAcknowledge={() => setCleared(blocking.flag.id)}
          />
        ) : null}
        {planUpdated.at ? (
          <PlanUpdatedBanner
            at={planUpdated.at}
            onAcknowledge={() => {
              planUpdated.acknowledge()
              refetch()
            }}
          />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-start border-t border-border">
        <RunsRail depotId={depotId} date={date} className="hidden h-full self-stretch lg:flex" />

        <section className="flex min-h-0 min-w-px flex-1 flex-col self-stretch">
          {isError ? (
            <div className="p-6">
              <ErrorState error={error} onRetry={refetch} />
            </div>
          ) : isPending ? (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-[52px] w-full" />
              <Skeleton className="h-[58px] w-full" />
              <Skeleton className="h-[58px] w-full" />
              <Skeleton className="h-[58px] w-full" />
            </div>
          ) : !trip ? (
            <EmptyState title={t('loading.noTripTitle')} description={t('loading.noTripBody')} />
          ) : (
            <>
              <header className="flex flex-col border-b border-border lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:border-b lg:px-6 lg:pb-[15px] lg:pt-[14px]">
                <div className="flex items-center gap-2.5 border-b border-border px-5 pb-[13px] pt-2 lg:border-b-0 lg:p-0">
                  <Link
                    to="/dock"
                    aria-label={t('loading.backToRuns')}
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 lg:hidden"
                  >
                    <Icon name="back" size={22} />
                  </Link>
                  <div className="flex min-w-px flex-1 flex-col gap-0.5">
                    <h1 className="type-heading m-0 text-foreground">
                      {t('loading.tripTitle', { vehicle: trip.vehicleId, tempClass: tempClassLabel(trip.tempClass) })}
                    </h1>
                    <p className="type-body m-0 text-muted-foreground">
                      <span className="hidden lg:inline">
                        {t('loading.tripSubtitle', {
                          tempClass: trip.tempClass === 'CHILLED' ? t('loading.reefer') : t('loading.dryBox'),
                          time: trip.plannedDepartAt ? formatColombo(trip.plannedDepartAt, 'HH:mm') : '—',
                          count: stops.length,
                        })}
                      </span>
                      <span className="lg:hidden">
                        {t('loading.tripSubtitleShort', {
                          tempClass: trip.tempClass === 'CHILLED' ? t('loading.reefer') : t('loading.dryBox'),
                          time: trip.plannedDepartAt ? formatColombo(trip.plannedDepartAt, 'HH:mm') : '—',
                        })}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 lg:gap-3 lg:border-b-0 lg:p-0">
                  <p className="type-data-bold m-0 text-foreground">
                    {t('loading.itemsOf', { checked, total })}
                    {awaiting.length > 0 ? (
                      <span className="text-status-warning-fg">{t('loading.decided.count', { count: awaiting.length })}</span>
                    ) : open.length > 0 ? (
                      <span className="text-status-danger-fg">{t('loading.flagged.count', { count: open.length })}</span>
                    ) : null}
                  </p>
                  <button
                    type="button"
                    onClick={checkedBy.change}
                    className="type-label hidden cursor-pointer rounded-md border border-slate-300 bg-background px-3 py-2 uppercase text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 sm:block"
                  >
                    {checkedBy.name ? t('loading.checkedByName', { name: checkedBy.name }) : t('loading.checkedByUnset')}
                  </button>
                  <ScanItemField lines={lines} disabled={frozen} onFound={check} />
                </div>
              </header>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-1 lg:px-6">
                {stops.length === 0 ? (
                  <EmptyState title={t('loading.emptyListTitle')} description={t('loading.emptyListBody')} />
                ) : (
                  stops.map((stop, index) => (
                    <section key={`${stop.stopSeq}-${stop.orderId}`} className="flex flex-col">
                      <div className="flex items-center gap-2.5 pb-1.5 pt-2.5">
                        <p className="type-metadata m-0 font-bold uppercase text-foreground">{t('loading.stopSeq', { seq: stop.stopSeq })}</p>
                        <span className="flex h-[20.3px] items-center gap-1.5">
                          <Icon name="leaf" size={14} className="text-status-success-icon" />
                          <span className="type-body-strong text-foreground">{stop.outletName}</span>
                        </span>
                        {index === 0 ? <StatusChip tone="muted">{t('loading.loadFirst')}</StatusChip> : null}
                      </div>
                      <ul className="m-0 flex list-none flex-col p-0">
                        {stop.lines.map((line) => (
                          <LoadLineCard key={line.id} line={line} frozen={frozen} onCheck={check} onUndo={undo} />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>

              <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 pb-4 pt-[13px] lg:gap-3 lg:px-6 lg:pb-[14px] lg:pt-[15px]">
                {flaggable ? (
                  <Button variant="outline" className="h-[52px] flex-1 px-[21px] text-[16px] lg:flex-none" onClick={() => setFlagging(flaggable)}>
                    {t('loading.flagAnItem')}
                  </Button>
                ) : null}
                <Action
                  link={list?._links.release}
                  disabled={blocked}
                  className="order-1 h-[52px] flex-1 px-[21px] text-[16px] lg:order-none lg:flex-none"
                  onAction={() => void navigate(`/dock/trips/${id}/release`)}
                >
                  {t('loading.releaseTrip')}
                </Action>
                {awaiting.length > 0 ? (
                  <p className="type-body-medium order-2 m-0 w-full text-center text-status-warning-fg lg:order-none lg:w-auto lg:flex-1">
                    {t('loading.decided.releaseBlocked')}
                  </p>
                ) : open.length > 0 ? (
                  <p className="type-body-medium order-2 m-0 w-full text-center text-status-danger-fg lg:order-none lg:w-auto lg:flex-1">
                    <span className="hidden sm:inline">{t('loading.flagged.releaseBlocked', { count: open.length })}</span>
                    <span className="sm:hidden">{t('loading.flagged.releaseBlockedShort')}</span>
                  </p>
                ) : (
                  <p className="type-body-medium order-2 m-0 w-full text-center text-muted-foreground lg:order-none lg:w-auto lg:flex-1">
                    {t('loading.tickEveryItem')}
                  </p>
                )}
              </footer>
            </>
          )}
        </section>
      </div>

      {flagging ? (
        <FlagItemDialog
          tripId={id}
          tripRef={trip ? t('loading.tripTitle', { vehicle: trip.vehicleId, tempClass: tempClassLabel(trip.tempClass) }) : ''}
          lines={lines}
          line={flagging}
          onClose={() => setFlagging(null)}
        />
      ) : null}
      {checkedBy.dialog}
    </div>
  )
}
