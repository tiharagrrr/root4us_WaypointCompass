// Figma: 18 Publish plan · 185:16860, a dialog over 17.
import { usePlanBuildingPublish, type PlanDto, type UnplannedOrderDto } from '@compass/api-client'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { BRAND_GLYPH, dayLabel } from './plan-copy'

const SHOWN = 3

export interface PublishDialogProps {
  plan: PlanDto
  dayText: string
  depotName: string
  deferred: readonly UnplannedOrderDto[]
  onClose: () => void
  onPublished: () => Promise<void>
}

/**
 * 18: who hears about the plan, and the deferred orders whose stores are told why. Publishing
 * sends the plan's version, so a change made since the review is refused rather than published
 * unseen (AC-PLN-07, 19).
 */
export function PublishDialog({ plan, dayText, depotName, deferred, onClose, onPublished }: PublishDialogProps) {
  const publish = usePlanBuildingPublish()
  const toDate = deferred.find((o) => o.toDate)?.toDate
  const go = async () => {
    await publish.mutateAsync({
      id: plan.id,
      headers: { 'If-Match': `W/"${plan.version}"`, 'Idempotency-Key': globalThis.crypto.randomUUID() },
    })
    await onPublished()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !publish.isPending && onClose()}>
      <DialogContent className="w-[480px]">
        <DialogHeader
          title={`Publish plan for ${dayText}?`}
          description={`Loaders at ${depotName} get their loading lists and drivers see their trips once loading starts.${
            deferred.length
              ? ` The ${deferred.length} deferred ${deferred.length === 1 ? 'order moves' : 'orders move'} to ${toDate ? dayLabel(toDate) : 'the next run'}, and their store managers are told why.`
              : ''
          }`}
        />
        {deferred.length ? (
          <div className="px-5 py-4">
            <ul className="m-0 list-none rounded-md border border-border p-0">
              {deferred.slice(0, SHOWN).map((o) => {
                const glyph = BRAND_GLYPH[o.brand] ?? BRAND_GLYPH.FRESH
                return (
                  <li key={o.orderId} className="flex items-center gap-2 border-t border-slate-100 px-3.5 py-2.5 first:border-t-0">
                    <Icon name={glyph.icon} size={14} className={glyph.className} />
                    <span className="type-body-medium font-bold text-foreground">{o.outletName}</span>
                    <span className="type-mono-small flex-1 text-muted-foreground">{o.orderNo}</span>
                    {o.repeatSkip ? <StatusChip tone="danger">2nd deferral</StatusChip> : null}
                  </li>
                )
              })}
              {deferred.length > SHOWN ? (
                <li className="type-label border-t border-slate-100 px-3.5 py-2.5 uppercase text-muted-foreground">+ {deferred.length - SHOWN} more</li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {publish.isError ? (
          <div className="px-5 pb-3">
            <ErrorState error={publish.error} />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={publish.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={publish.isPending} onClick={() => void go().catch(() => undefined)}>
            Publish plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
