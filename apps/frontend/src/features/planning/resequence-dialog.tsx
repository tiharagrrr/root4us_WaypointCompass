// Figma: 19b Re-sequence stops · 464:2353
import { useTripOperationsPreview, useTripOperationsResequence, type PlanStopDto, type TripDto } from '@compass/api-client'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatColombo } from '@/lib/format-colombo'
import { isLink, type Link } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { DeferStopDialog } from './defer-stop-dialog'
import { BRAND_GLYPH, clock } from './plan-copy'
import { RevisionReasonBar, type RevisionReason } from './revision-reason'

export interface ResequenceDialogProps {
  trip: TripDto
  /** The trip's `resequence` link; the dialog exists only when the trip carries it. */
  link: Link
  /** The trip's templated `deferStop` link; each stop's Defer… shows only with it. */
  deferLink?: unknown
  /** The trip's version, for If-Match. */
  version: number
  /** The plan's revision, which this change raises by one. */
  revision: number
  onClose: () => void
  onDone: () => void
}

/** How a stop's projected arrival sits against its window, as 19b's Status column says it. */
function standing(spare: number | null | undefined): { label: string; tone: 'neutral' | 'warning' | 'danger' } | null {
  if (spare === null || spare === undefined) return null
  if (spare < 0) return { label: 'Late', tone: 'danger' }
  if (spare < 15) return { label: 'At risk', tone: 'warning' }
  return { label: 'On time', tone: 'neutral' }
}

/**
 * 19b: the stops still to come, reordered with the arrows (AC-PLN-24). Every order is previewed on
 * the server with the same engine check Apply runs (AC-PLN-38): the projected arrival and minutes
 * spare per stop, and any window the order would miss. Nothing changes until Apply. A stop can also
 * be deferred to the next run from here (AC-PLN-25).
 */
export function ResequenceDialog({ trip, link, deferLink, version, revision, onClose, onDone }: ResequenceDialogProps) {
  const pending = trip.stops.filter((s) => s.status === 'PENDING').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const [order, setOrder] = useState(() => pending.map((s) => s.id))
  const [reason, setReason] = useState<RevisionReason>({ note: '' })
  const [deferring, setDeferring] = useState<PlanStopDto | null>(null)
  const [key] = useState(() => globalThis.crypto.randomUUID())
  const resequence = useTripOperationsResequence()
  const preview = useTripOperationsPreview()
  const { mutate: runPreview } = preview
  const byId = new Map(pending.map((s) => [s.id, s]))
  const was = new Map(pending.map((s, i) => [s.id, i]))
  const changed = order.some((id, i) => was.get(id) !== i)
  const glyph = BRAND_GLYPH[trip.brand]

  // Every order the dispatcher tries is projected by the server.
  const orderKey = order.join(',')
  useEffect(() => {
    runPreview({ id: trip.id, data: { stopIds: orderKey.split(',') } })
  }, [runPreview, trip.id, orderKey])
  const projected = new Map((preview.data?.data.stops ?? []).map((s) => [s.stopId, s]))
  const broken = (preview.data?.data.violations ?? []).filter((v) => v.severity === 'HARD')

  const move = (i: number, by: -1 | 1) =>
    setOrder((now) => {
      const next = [...now]
      const j = i + by
      if (j < 0 || j >= next.length) return now
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  // "KANDANA MOVED AHEAD OF JA-ELA": the first stop that now comes earlier, and who it passed.
  const summary = (() => {
    for (const [i, id] of order.entries()) {
      if ((was.get(id) ?? i) > i) return `${byId.get(id)?.outletName ?? ''} moved ahead of ${pending[i]?.outletName ?? ''}`
    }
    return changed ? 'Order changed' : 'Use the arrows to change the order'
  })()

  const apply = async () => {
    await resequence.mutateAsync({
      id: trip.id,
      data: { stopIds: order, reasonCode: reason.reasonCode, ...(reason.note.trim() ? { note: reason.note.trim() } : {}) },
      headers: { 'If-Match': `W/"${version}"`, 'Idempotency-Key': key },
    })
    toast({ title: `${trip.vehicleCode} re-sequenced`, description: 'The driver and the stores on this trip are told.', tone: 'success' })
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !resequence.isPending && onClose()}>
      <DialogContent className="w-[824px]">
        <DialogHeader
          title={`Re-sequence ${trip.vehicleCode} stops`}
          description={`Reorder the ${pending.length} remaining stops. Projected arrivals update as you go. Nothing changes until you apply.`}
        />
        <DialogBody className="px-5 py-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-page text-left">
                  {['#', 'Move', 'Stop', 'Window', 'Projected ETA', 'Status', ''].map((h, i) => (
                    <th key={`${h}${i}`} className="type-label px-3 py-2.5 font-normal uppercase text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.map((id, i) => {
                  const stop = byId.get(id)!
                  const moved = was.get(id) !== i
                  const p = projected.get(id)
                  const state = standing(p?.spareMin)
                  return (
                    <tr key={id} aria-label={stop.outletName} className={cn('border-t border-border', moved && 'bg-accent')}>
                      <td className="px-3 py-3 font-mono text-[12px] font-bold">{String(i + 1).padStart(2, '0')}</td>
                      <td className="px-3 py-3">
                        <span className="flex gap-1">
                          <Button size="icon-sm" variant="outline" aria-label={`Move ${stop.outletName} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                            ↑
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={`Move ${stop.outletName} down`}
                            disabled={i === order.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            ↓
                          </Button>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-col">
                          <span className="type-body-medium flex items-center gap-2 font-bold text-foreground">
                            {glyph ? <Icon name={glyph.icon} size={14} className={glyph.className} /> : null}
                            {stop.outletName}
                            {moved ? (
                              <StatusChip tone="neutral">
                                <Icon name="check" size={12} /> Moved
                              </StatusChip>
                            ) : null}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">{stop.orderNo}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px]">{clock(stop.windowCloseMin)}</td>
                      <td className="px-3 py-3 font-mono text-[12px]">
                        {p?.arrivalAt ? (
                          <span className={cn('font-bold', state?.tone === 'danger' ? 'text-destructive-foreground' : state?.tone === 'warning' ? 'text-status-warning-fg' : 'text-foreground')}>
                            {formatColombo(p.arrivalAt, 'HH:mm')}
                            <span className="ml-1.5 font-normal">
                              {p.spareMin !== null && p.spareMin < 0 ? `${-p.spareMin} min late` : `${p.spareMin} min spare`}
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-3">{state ? <StatusChip tone={state.tone}>{state.label}</StatusChip> : null}</td>
                      <td className="px-3 py-3 text-right">
                        {isLink(deferLink) ? (
                          <Button size="sm" variant="outline" onClick={() => setDeferring(stop)}>
                            Defer…
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {broken.length ? (
            <ul aria-label="What this order breaks" className="m-0 flex list-none flex-col gap-1 rounded-md border border-status-danger-border bg-status-danger-bg p-3">
              {broken.map((v) => (
                <li key={`${v.rule}${v.orderId ?? ''}`} className="type-body-small text-destructive-foreground">
                  {v.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="type-body-small m-0 text-muted-foreground">
            The driver of {trip.vehicleCode} gets the new order on the phone, and the stores on this trip see their new times.
          </p>
          {/* The projection could not be checked: say so, rather than leaving the times blank. */}
          {preview.isError ? (
            <ErrorState
              error={preview.error}
              onRetry={() => runPreview({ id: trip.id, data: { stopIds: order } })}
            />
          ) : null}
          {resequence.isError ? <ErrorState error={resequence.error} /> : null}
        </DialogBody>
        <RevisionReasonBar revision={revision} value={reason} onChange={setReason} />
        <DialogFooter className="justify-between">
          <p className="type-mono-small m-0 uppercase text-muted-foreground">{summary}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={resequence.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!changed || !reason.reasonCode || broken.length > 0}
              loading={resequence.isPending}
              title={link.title}
              onClick={() => void apply().catch(() => undefined)}
            >
              Apply and notify
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      {deferring ? <DeferStopDialog tripId={trip.id} stop={deferring} version={version} onClose={() => setDeferring(null)} onDone={onDone} /> : null}
    </Dialog>
  )
}
