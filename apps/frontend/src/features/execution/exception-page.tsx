// Figma: D5 Exception · 185:20240
import type { DeliveryOutcome } from '@waypoint/shared'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useParams } from 'react-router'
import { db, enqueue, useCachedStops, useCachedTrip, type QueuedLine } from '@/offline'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { QuantityStepper } from '@/ui/quantity-stepper'
import { RadioCards } from '@/ui/radio-cards'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState } from '@/ui/states'
import { Textarea } from '@/ui/textarea'
import { flushAttachments, queueAttachment } from './attachments'
import { cachedStopLinks } from './offline-links'

/**
 * The outcomes a driver can record here. `PARTIAL` is a delivery that fell short — somebody took
 * the crates — so it goes out as a PARTIAL event; the other three are a stop that failed, and the
 * server refuses a FAILED event carrying DELIVERED or PARTIAL (`domain/proof-rules.ts`).
 */
const OUTCOMES = ['PARTIAL', 'REFUSED', 'DAMAGED', 'OUTLET_CLOSED'] as const
type Outcome = (typeof OUTCOMES)[number]

const LABELS: Record<Outcome, string> = {
  PARTIAL: 'driver.outcomePartial',
  REFUSED: 'driver.outcomeRefused',
  DAMAGED: 'driver.outcomeDamaged',
  OUTLET_CLOSED: 'driver.outcomeOutletClosed',
}

/**
 * D5 is the screen that keeps a bad stop honest: what happened, what was actually handed over, a
 * photo and a note for whoever picks the order up tomorrow (AC-EXE-12). Like D4 it writes once, and
 * only through the outbox, so a refusal recorded in a basement still reaches the dispatcher.
 */
export function ExceptionPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()

  const stop = useLiveQuery(async () => (await db.stops.get(id)) ?? null, [id], undefined)
  const trip = useCachedTrip(stop?.tripId)
  const siblings = useCachedStops(stop?.tripId)
  const lines = useLiveQuery(() => db.stopLines.where('stopId').equals(id).toArray(), [id], [])

  const [outcome, setOutcome] = useState<Outcome | undefined>()
  const [delivered, setDelivered] = useState<Record<string, number>>({})
  const [receiverName, setReceiverName] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement | null>(null)

  if (stop === undefined) return <Skeleton className="h-[420px] w-full" />
  if (!stop || !trip || trip.status !== 'IN_PROGRESS')
    return (
      <EmptyState
        title={t('driver.otherTripTitle')}
        description={t('driver.otherTripBody')}
        action={
          <Button asChild variant="outline">
            <RouterLink to="/driver">{t('driver.backToTrip')}</RouterLink>
          </Button>
        }
      />
    )

  const seq = siblings.findIndex((s) => s.id === stop.id) + 1
  const links = cachedStopLinks(stop, trip.status)

  const save = async () => {
    // The server's own checks, run here so a driver with no signal hears them now (AC-EXE-10).
    if (!outcome) return setError(t('driver.needOutcome'))
    if (!photo) return setError(t('driver.needPhoto'))
    if (outcome === 'PARTIAL' && !receiverName.trim()) return setError(t('driver.needReceiver'))
    if (!note.trim()) return setError(outcome === 'PARTIAL' ? t('driver.needShortNote') : t('driver.needNote'))
    setError(null)

    const { clientUuid } = await queueAttachment(photo, 'photo')
    const recorded: QueuedLine[] = lines.map((line) => ({
      orderLineId: line.orderLineId,
      qtyDelivered: delivered[line.id] ?? 0,
      condition: 'ok',
    }))

    await enqueue({
      kind: 'driver',
      type: outcome === 'PARTIAL' ? 'PARTIAL' : 'FAILED',
      tripId: stop.tripId,
      stopId: stop.id,
      outcome: outcome as DeliveryOutcome,
      receiverName: outcome === 'PARTIAL' ? receiverName.trim() : undefined,
      note: note.trim(),
      lines: recorded,
      attachmentUuids: [clientUuid],
      baseVersion: stop.version,
    })
    void flushAttachments({ type: 'stop', id: stop.id }, { kinds: { photo: 'EXCEPTION_PHOTO', signature: 'SIGNATURE' } })

    const next = siblings.find((s) => s.status === 'PENDING' && s.id !== stop.id)
    // An exception on the last stop still ends the round, so it lands on D7 like a delivery does.
    void navigate(next ? `/driver/stops/${next.id}` : `/driver/trips/${stop.tripId}/done`)
  }

  return (
    <>
      <header className="-mx-4 flex items-center gap-2.5 border-b border-border px-4 pb-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('driver.back')} className="size-11">
          <RouterLink to={`/driver/stops/${stop.id}/record`}>
            <Icon name="chevron-down" size={22} className="rotate-90" />
          </RouterLink>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="type-heading m-0 text-foreground">{t('driver.exceptionTitle', { n: seq })}</h1>
          <span className="flex items-center gap-1.5">
            {trip.tempClass === 'CHILLED' ? <Icon name="leaf" size={14} className="text-teal-700" /> : null}
            <span className="type-body truncate text-muted-foreground">{stop.outletName}</span>
          </span>
        </div>
      </header>

      <section className="flex w-full flex-col gap-1.5">
        <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.whatHappened')}</p>
        <RadioCards
          aria-label={t('driver.whatHappened')}
          options={OUTCOMES.map((value) => ({ value, label: t(LABELS[value]) }))}
          value={outcome}
          onValueChange={setOutcome}
        />
      </section>

      <section className="flex w-full flex-col">
        <p className="type-label m-0 pb-1 uppercase text-muted-foreground">{t('driver.itemsAffected')}</p>
        {lines.map((line) => (
          <div key={line.id} className="flex items-center gap-2.5 border-t border-slate-100 pt-[11px] pb-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <p className="type-field-label m-0 text-foreground">{line.itemName}</p>
              <p className="type-caption m-0 text-muted-foreground">
                {t('driver.orderedDelivered', { qty: line.qtyOrdered })}
              </p>
            </div>
            <QuantityStepper
              value={delivered[line.id] ?? 0}
              onValueChange={(qty) => setDelivered((previous) => ({ ...previous, [line.id]: qty }))}
              min={0}
              max={line.qtyOrdered}
              label={line.itemName}
            />
          </div>
        ))}
      </section>

      {outcome === 'PARTIAL' ? (
        <Input
          className="h-12 text-[15px]"
          placeholder={t('driver.receiverName')}
          aria-label={t('driver.receiverName')}
          value={receiverName}
          onChange={(event) => setReceiverName(event.target.value)}
        />
      ) : null}

      <section className="flex w-full flex-col gap-1.5">
        <div className="flex items-start justify-between">
          <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.photo')}</p>
          <p className="type-caption m-0 text-muted-foreground">{t('driver.required')}</p>
        </div>
        <Button
          variant="outline"
          className="h-[66px] w-full border-dashed bg-page text-[13px] font-normal text-muted-foreground"
          onClick={() => photoInput.current?.click()}
        >
          <Icon name="camera" size={18} />
          {photo ? photo.name : t('driver.addPhoto')}
        </Button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label={t('driver.addPhoto')}
          onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
        />
      </section>

      <section className="flex w-full flex-col gap-1.5">
        <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.note')}</p>
        <Textarea
          className="h-[60px]"
          placeholder={t('driver.notePlaceholder')}
          aria-label={t('driver.note')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error ? (
          <p role="alert" className="type-caption m-0 text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </section>

      <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background px-4 pt-[13px] pb-2">
        <Action link={links.fail} onAction={save} variant="default" className="h-[52px] w-full text-[16px]">
          {t('driver.saveException')}
        </Action>
        <p className="type-caption m-0 text-center text-muted-foreground">{t('driver.savedOnPhone')}</p>
      </footer>
    </>
  )
}
