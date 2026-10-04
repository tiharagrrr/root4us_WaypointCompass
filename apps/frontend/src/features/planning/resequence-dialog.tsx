// Figma: 19b Re-sequence stops · 464:2353
import { useTripOperationsResequence, type TripDto } from '@compass/api-client'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { formatColombo } from '@/lib/format-colombo'
import type { Link } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { BRAND_GLYPH } from './plan-copy'
import { RevisionReasonBar, type RevisionReason } from './revision-reason'

export interface ResequenceDialogProps {
  trip: TripDto
  /** The trip's `resequence` link; the dialog exists only when the trip carries it. */
  link: Link
  /** The trip's version, for If-Match. */
  version: number
  /** The plan's revision, which this change raises by one. */
  revision: number
  onClose: () => void
  onDone: () => void
}

/**
 * 19b: the stops still to come, reordered with the arrows (AC-PLN-24). Nothing changes until Apply;
 * the server checks the new order with the engine from where the trip is now, and a stop that would
 * miss its window comes back as the problem, with nothing saved.
 */
export function ResequenceDialog({ trip, link, version, revision, onClose, onDone }: ResequenceDialogProps) {
  const pending = trip.stops.filter((s) => s.status === 'PENDING').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const [order, setOrder] = useState(() => pending.map((s) => s.id))
  const [reason, setReason] = useState<RevisionReason>({ note: '' })
  const [key] = useState(() => globalThis.crypto.randomUUID())
  const resequence = useTripOperationsResequence()
  const byId = new Map(pending.map((s) => [s.id, s]))
  const was = new Map(pending.map((s, i) => [s.id, i]))
  const changed = order.some((id, i) => was.get(id) !== i)
  const glyph = BRAND_GLYPH[trip.brand]

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
      const before = was.get(id) ?? i
      if (before > i) {
        const passed = pending[i]
        return `${byId.get(id)?.outletName ?? ''} moved ahead of ${passed?.outletName ?? ''}`
      }
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
          description={`Reorder the ${pending.length} remaining stops. Nothing changes until you apply.`}
        />
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-page text-left">
                  {['#', 'Move', 'Stop', 'Window', 'Planned arrival', 'Status'].map((h) => (
                    <th key={h} className="type-label px-3 py-2.5 font-normal uppercase text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.map((id, i) => {
                  const stop = byId.get(id)!
                  const moved = was.get(id) !== i
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
                        <span className="type-body-medium flex items-center gap-2 font-bold text-foreground">
                          {glyph ? <Icon name={glyph.icon} size={14} className={glyph.className} /> : null}
                          {stop.outletName}
                          {moved ? (
                            <StatusChip tone="neutral">
                              <Icon name="check" size={12} /> Moved
                            </StatusChip>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px]">
                        {stop.window.open}–{stop.window.close}
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px]">{stop.plannedArrivalAt ? formatColombo(stop.plannedArrivalAt, 'HH:mm') : '—'}</td>
                      <td className="px-3 py-3">
                        <StatusChip tone="muted">Pending</StatusChip>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="type-body-small m-0 text-muted-foreground">
            The driver of {trip.vehicleCode} gets the new order on the phone, and the stores on this trip see their new times.
          </p>
          {resequence.isError ? <ErrorState error={resequence.error} /> : null}
        </div>
        <RevisionReasonBar revision={revision} value={reason} onChange={setReason} />
        <DialogFooter className="justify-between">
          <p className="type-mono-small m-0 uppercase text-muted-foreground">{summary}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={resequence.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!changed || !reason.reasonCode}
              loading={resequence.isPending}
              title={link.title}
              onClick={() => void apply().catch(() => undefined)}
            >
              Apply and notify
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
