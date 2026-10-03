// Figma: 16 Swap order · 185:16098, a dialog over 15.
import type { DeferralDecisionDto, DeferralReasonDto, TripDto, UnplannedOrderDto } from '@compass/api-client'
import {
  applyEdits,
  priorityOf,
  resolveParams,
  type EngineInput,
  type Plan,
  type ScheduledTrip,
  planSchedule,
} from '@waypoint/engine'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { StatusChip } from '@/ui/status-chip'
import { Textarea } from '@/ui/textarea'
import { BRAND_GLYPH, BRAND_WORD, kg } from './plan-copy'

export interface SwapDialogProps {
  /** The repeat skip to serve. */
  order: UnplannedOrderDto
  engine: { input: EngineInput; plan: Plan }
  /** The saved trips, for outlet names and vehicle codes. */
  trips: readonly TripDto[]
  reasons: readonly DeferralReasonDto[]
  busy: boolean
  onClose: () => void
  onSwap: (decision: DeferralDecisionDto) => Promise<void>
}

interface Candidate {
  orderId: string
  tripKey: string
  priority: number
  after: ScheduledTrip | undefined
}

/**
 * Every order on a trip that the repeat skip could take the place of: swapping them must leave
 * the plan with no new hard violation (the engine's applyEdits, run in the browser), and the order
 * coming off must itself not be a repeat skip. The lowest priority comes first and is recommended
 * (AC-PLN-18).
 */
function candidatesFor(input: EngineInput, plan: Plan, orderId: string): Candidate[] {
  const params = resolveParams(input.params)
  const repeat = new Set(plan.unplanned.filter((u) => u.repeatSkip).map((u) => u.orderId))
  const found: Candidate[] = []
  for (const trip of plan.trips) {
    const tripKey = trip.key ?? ''
    for (const other of trip.orderIds) {
      if (repeat.has(other)) continue
      const result = applyEdits(input, plan, [
        { op: 'UNASSIGN_ORDER', orderId: other },
        { op: 'ASSIGN_ORDER', orderId, tripKey },
      ])
      if (result.introduced.some((v) => v.severity === 'HARD')) continue
      const order = input.orders.find((o) => o.id === other)
      if (!order) continue
      found.push({
        orderId: other,
        tripKey,
        priority: priorityOf(input, order, params),
        after: planSchedule(input, result.plan).find((t) => t.key === tripKey),
      })
    }
  }
  return found.sort((a, b) => a.priority - b.priority || a.orderId.localeCompare(b.orderId))
}

/** 16: serve a repeat skip on a trip, and defer one of that trip's orders in its place. */
export function SwapDialog({ order, engine, trips, reasons, busy, onClose, onSwap }: SwapDialogProps) {
  const candidates = useMemo(() => candidatesFor(engine.input, engine.plan, order.orderId), [engine, order.orderId])
  const [pick, setPick] = useState(candidates[0]?.orderId)
  const [note, setNote] = useState('')
  const chosen = candidates.find((c) => c.orderId === pick)
  const stopOf = (orderId: string) => trips.flatMap((t) => t.stops.map((s) => ({ ...s, trip: t }))).find((s) => s.orderId === orderId)
  const engineOrder = (orderId: string) => engine.input.orders.find((o) => o.id === orderId)
  const vehicleOf = (tripKey: string) => engine.input.vehicles.find((v) => v.code === tripKey.split('#')[0])
  const tripLabel = (tripKey: string) => {
    const [code, no] = tripKey.split('#')
    const saved = trips.find((t) => t.key === tripKey)
    return `${code} · Trip ${no}${saved ? ` · ${BRAND_WORD[saved.brand] ?? saved.brand} · ${saved.districtName}` : ''}`
  }
  const reasonCode = order.reasonCode ?? reasons[0]?.code ?? 'OVER_CAPACITY'
  const glyph = BRAND_GLYPH[order.brand] ?? BRAND_GLYPH.FRESH
  const chosenName = chosen ? (stopOf(chosen.orderId)?.outletName ?? engineOrder(chosen.orderId)?.ref ?? '') : ''
  const vehicle = chosen ? vehicleOf(chosen.tripKey) : undefined

  const swap = () => {
    if (!chosen) return
    void onSwap({
      orderId: order.orderId,
      action: 'SWAP',
      reasonCode,
      tripKey: chosen.tripKey,
      swapOrderId: chosen.orderId,
      swapReasonCode: reasonCode,
      swapNote: note.trim(),
    }).catch(() => undefined)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[600px]">
        <DialogHeader
          title={`Swap in ${order.outletName}`}
          description={
            chosen
              ? `Deferred on the last run too. Serve it on ${tripLabel(chosen.tripKey).split(' · ').slice(0, 2).join(' ')} and defer another stop on that trip instead.`
              : 'No order on a trip can make room for it without breaking a rule. Override with a note instead.'
          }
        />
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-page px-4 py-3">
              <span className="type-label uppercase text-muted-foreground">Serve</span>
              <span className="type-body-medium flex items-center gap-1.5 font-bold text-foreground">
                <Icon name={glyph.icon} size={14} className={glyph.className} />
                {order.outletName} · {order.orderNo}
              </span>
              <span className="type-body-small text-muted-foreground">
                {kg(order.weightKg)} · {order.volumeM3.toFixed(1)} m³
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-page px-4 py-3">
              <span className="type-label uppercase text-muted-foreground">On</span>
              <span className="type-body-medium font-bold text-foreground">{chosen ? tripLabel(chosen.tripKey) : '—'}</span>
            </div>
          </div>

          {candidates.length ? (
            <div className="flex flex-col gap-2">
              <span className="type-label uppercase text-muted-foreground">Defer instead</span>
              <div role="radiogroup" aria-label="Defer instead" className="flex flex-col gap-2">
                {candidates.map((c, i) => {
                  const on = c.orderId === pick
                  const o = engineOrder(c.orderId)
                  const stop = stopOf(c.orderId)
                  const g = BRAND_GLYPH[o?.brand ?? 'FRESH'] ?? BRAND_GLYPH.FRESH
                  return (
                    <label
                      key={`${c.tripKey}:${c.orderId}`}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5',
                        on ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-slate-50',
                      )}
                    >
                      <input type="radio" name="swap" className="accent-primary" checked={on} onChange={() => setPick(c.orderId)} />
                      <span className="flex min-w-px flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-sans text-[13px] font-bold text-foreground">
                          <span className="font-mono">{o?.ref}</span>
                          <Icon name={g.icon} size={14} className={g.className} />
                          {stop?.outletName ?? ''}
                        </span>
                        <span className="type-body-small text-muted-foreground">
                          {kg(o?.weightKg ?? 0)} · {(o?.volumeM3 ?? 0).toFixed(1)} m³ · {c.tripKey.replace('#', ' trip ')}
                        </span>
                      </span>
                      {i === 0 ? <StatusChip tone="neutral">Recommended</StatusChip> : null}
                    </label>
                  )
                })}
              </div>
            </div>
          ) : null}

          {chosen ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="type-label uppercase text-muted-foreground">Note for {chosenName}</span>
                <Textarea
                  aria-label={`Note for ${chosenName}`}
                  rows={3}
                  placeholder="Why their order moves to the next run. The store reads it."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {chosen.after && vehicle ? (
                <p className="m-0 flex items-center justify-between rounded-md border border-border px-4 py-2.5">
                  <span className="type-body text-foreground">{chosen.tripKey.replace('#', ' Trip ')} after the swap</span>
                  <span className="font-mono text-[12px] font-bold uppercase text-foreground">
                    {kg(chosen.after.weightKg).replace(' kg', '')} / {kg(vehicle.weightCapKg)} · {chosen.after.volumeM3.toFixed(1)} / {vehicle.volumeCapM3} m³ · Checks pass
                  </span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter className="justify-between">
          <p className="type-body-small m-0 text-muted-foreground">Both stores are told when you publish.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" disabled={!chosen || note.trim() === ''} loading={busy} onClick={swap}>
              Swap orders
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
