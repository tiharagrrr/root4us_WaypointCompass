// The order timeline: every step with who, when, device and reason. No Figma frame draws it
// (M8 and 04 only open it), so it reuses the issue dialog's layout; see docs/departures.md.
import { useTimelinesOrder } from '@compass/api-client'
import { formatColombo } from '@/lib/format-colombo'
import { Dialog, DialogContent, DialogHeader } from '@/ui/dialog'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { entryActor, entryReason, entrySource, entryTitle } from './timeline-copy'

export interface OrderTimelineDialogProps {
  orderId: string
  orderNo: string
  onClose: () => void
}

/**
 * One order's history, oldest first, merged across ordering, planning, loading, delivery and
 * receipt (AC-AUD-03). A step that reached the server late keeps the time it happened on the
 * device and carries a Synced late chip with the time it arrived.
 */
export function OrderTimelineDialog({ orderId, orderNo, onClose }: OrderTimelineDialogProps) {
  const query = useTimelinesOrder(orderId)
  const entries = query.data?.data ?? []

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[560px] max-w-[calc(100vw-2rem)]">
        <DialogHeader title="Order timeline" description={`Order #${orderNo}`} />
        <div className="flex max-h-[70vh] flex-col overflow-y-auto px-5 pb-5 pt-4">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <Skeleton className="h-[320px] w-full" />
          ) : entries.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Each step shows here as it happens." />
          ) : (
            <ol aria-label="Timeline" className="m-0 flex list-none flex-col p-0">
              {entries.map((entry) => {
                const reason = entryReason(entry)
                const source = entrySource(entry)
                return (
                  <li key={entry.id} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                    <time dateTime={entry.occurredAt} className="w-[92px] shrink-0 font-mono text-[12px] text-muted-foreground">
                      {formatColombo(entry.occurredAt, 'EEE d MMM')}
                      <br />
                      {formatColombo(entry.occurredAt, 'HH:mm:ss')}
                    </time>
                    <div className="flex min-w-px flex-1 flex-col gap-1">
                      <p className="m-0 flex flex-wrap items-center gap-2">
                        <span className="type-body-medium font-bold text-foreground">{entryTitle(entry)}</span>
                        {entry.syncedLate ? (
                          <StatusChip tone="warning">Synced late · {formatColombo(entry.recordedAt, 'HH:mm')}</StatusChip>
                        ) : null}
                      </p>
                      <p className="type-body-small m-0 text-muted-foreground">
                        {entryActor(entry)}
                        {source && entry.actorName ? ` · ${source}` : ''}
                        {entry.deviceId ? ` · Device ${entry.deviceId.slice(0, 8)}` : ''}
                      </p>
                      {reason ? <p className="type-body-small m-0 text-foreground">Reason: {reason}</p> : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
