// Figma: 23 Deferrals · 185:18890, the panel beside the log (ROO-43).
import {
  getDeferralsListQueryKey,
  getOrdersGetQueryKey,
  useDeferralsList,
  useOrdersGet,
  useOrdersSetPriority,
  type DeferralDto,
} from '@compass/api-client'
import { instantAt } from '@waypoint/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatColombo } from '@/lib/format-colombo'
import { Action } from '@/ui/action'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { BRAND_GLYPH } from '@/features/planning/plan-copy'
import { PANEL_EYEBROW, placeName } from './deferral-copy'
import { ReplyDialog } from './reply-dialog'

/** "Thu 24 Sep" in the history list. */
const historyDay = (date: string) => formatColombo(instantAt(date, 720), 'EEE d MMM')

/**
 * One deferral up close: what the store said, the outlet's recent deferrals, and the two things a
 * dispatcher does about it. Pin to next run marks the order urgent through its `priority` link,
 * so the next run's queue ranks it first; Reply to store shows only with the deferral's `reply`
 * link (AC-PLN-35).
 */
export function DeferralPanel({ deferral: d }: { deferral: DeferralDto }) {
  const queryClient = useQueryClient()
  const order = useOrdersGet(d.orderId).data?.data
  const history = useDeferralsList({ 'filter[outletId]': d.outletId, sort: '-fromDate', limit: 5 })
  const setPriority = useOrdersSetPriority()
  const [replying, setReplying] = useState(false)
  const glyph = BRAND_GLYPH[d.outletBrand]

  const pin = async (headers: Record<string, string>) => {
    await setPriority.mutateAsync({ id: d.orderId, data: { urgent: true }, headers: { 'If-Match': headers['If-Match'] ?? '' } })
    void queryClient.invalidateQueries({ queryKey: getOrdersGetQueryKey(d.orderId) })
    void queryClient.invalidateQueries({ queryKey: getDeferralsListQueryKey() })
    toast({ title: `${d.orderNo} goes first on the next run`, tone: 'success' })
  }

  return (
    <aside aria-label={`Deferral ${d.orderNo}`} className="flex flex-col rounded-lg border border-border bg-background">
      <header className="flex flex-col gap-2 border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="type-label uppercase text-muted-foreground">{PANEL_EYEBROW[d.storeResponse] ?? d.storeResponse}</span>
          <span className="font-mono text-[12px] text-muted-foreground">{d.orderNo}</span>
        </div>
        <h2 className="type-card-title m-0 flex items-center gap-2 text-[18px] text-foreground">
          {glyph ? <Icon name={glyph.icon} size={16} className={glyph.className} /> : null}
          {placeName(d.outletName)}
        </h2>
        <div className="flex flex-wrap gap-2">
          {d.repeatSkip ? <StatusChip tone="danger">Repeat skip</StatusChip> : null}
          {d.recentRuns ? (
            <StatusChip tone="muted">
              {d.recentSkips} of last {d.recentRuns} runs
            </StatusChip>
          ) : null}
          {order?.urgent ? <StatusChip tone="info">Pinned to next run</StatusChip> : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="type-label m-0 uppercase text-muted-foreground">Note from store manager</h3>
          {d.storeNote ? (
            <>
              <p className="type-body m-0 rounded-md border border-border bg-page px-3.5 py-3 text-foreground">{d.storeNote}</p>
              <p className="type-body-small m-0 text-muted-foreground">
                {[d.storeRespondedByName, d.storeRespondedAt ? formatColombo(d.storeRespondedAt, 'EEE d MMM, HH:mm') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </>
          ) : (
            <p className="type-body m-0 text-muted-foreground">
              {d.storeResponse === 'AWAITING' ? 'The store hasn’t answered yet.' : 'The store acknowledged it without a note.'}
            </p>
          )}
        </section>

        {d.dispatcherReply ? (
          <section className="flex flex-col gap-1.5">
            <h3 className="type-label m-0 uppercase text-muted-foreground">Your reply</h3>
            <p className="type-body m-0 rounded-md border border-status-info-border bg-accent px-3.5 py-3 text-foreground">{d.dispatcherReply}</p>
            {d.dispatcherRepliedAt ? (
              <p className="type-body-small m-0 text-muted-foreground">{formatColombo(d.dispatcherRepliedAt, 'EEE d MMM, HH:mm')}</p>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-1">
          <h3 className="type-label m-0 uppercase text-muted-foreground">History</h3>
          {history.isError ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : history.isPending ? (
            <Skeleton className="h-[90px] w-full" />
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {(history.data?.data ?? []).map((h, i, all) => (
                <li key={h.id} className="relative flex items-center justify-between gap-3 py-1.5">
                  {i < all.length - 1 ? (
                    <span aria-hidden="true" className="absolute left-[4px] top-[22px] h-[calc(100%-14px)] border-l-2 border-dotted border-slate-400" />
                  ) : null}
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-slate-400 bg-background" />
                    <span className="font-mono text-[12px] font-bold text-foreground">{historyDay(h.fromDate)}</span>
                  </span>
                  <span className="type-body-small text-muted-foreground">{h.reasonLabel}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="flex flex-col gap-2">
          {order && !order.urgent ? (
            <Action
              link={order._links.priority}
              variant="default"
              version={order.version}
              onAction={({ headers }) => pin(headers)}
            >
              Pin to next run
            </Action>
          ) : null}
          <Action link={d._links.reply} variant="outline" onAction={() => setReplying(true)}>
            Reply to store
          </Action>
          {setPriority.isError ? <ErrorState error={setPriority.error} /> : null}
        </div>
      </div>

      {replying ? <ReplyDialog deferral={d} onClose={() => setReplying(false)} /> : null}
    </aside>
  )
}
