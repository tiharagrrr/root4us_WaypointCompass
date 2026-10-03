// Figma: D4 Record stop · 185:20174
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useParams } from 'react-router'
import { db, enqueue, useCachedStops, useCachedTrip, type QueuedLine } from '@/offline'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { QuantityStepper } from '@/ui/quantity-stepper'
import { SegmentedControl } from '@/ui/segmented-control'
import { SignaturePad, type SignaturePadHandle } from '@/ui/signature-pad'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState } from '@/ui/states'
import { Action } from '@/ui/action'
import { flushAttachments, queueAttachment } from './attachments'
import { cachedStopLinks } from './offline-links'

interface LineState {
  /** Packs actually handed over; the ordered quantity until the driver says otherwise. */
  qty: number
  ticked: boolean
}

/**
 * D4 is where the delivery becomes a record. Everything on it is written once and never edited: the
 * event is append-only (AC-EXE-13), so the screen asks for everything the stop needs before it lets
 * the driver save, in the server's own words (`domain/proof-rules.ts`).
 *
 * The outcome is not a choice the driver makes twice. Ticking every line is DELIVERED; anything
 * short is PARTIAL and needs a note as well as the proof; nothing delivered at all belongs on D5.
 */
export function RecordStopPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()

  const stop = useLiveQuery(async () => (await db.stops.get(id)) ?? null, [id], undefined)
  const trip = useCachedTrip(stop?.tripId)
  const siblings = useCachedStops(stop?.tripId)
  const lines = useLiveQuery(() => db.stopLines.where('stopId').equals(id).toArray(), [id], [])

  const [state, setState] = useState<Record<string, LineState>>({})
  const [receiverName, setReceiverName] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [signed, setSigned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pad = useRef<SignaturePadHandle | null>(null)
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
  const lineState = (line: { id: string; qtyOrdered: number }): LineState =>
    state[line.id] ?? { qty: line.qtyOrdered, ticked: true }
  const short = lines.some((line) => {
    const current = lineState(line)
    return !current.ticked || current.qty < line.qtyOrdered
  })
  const outcome = short ? 'PARTIAL' : 'DELIVERED'
  const links = cachedStopLinks(stop, trip.status)

  const setLine = (lineId: string, next: Partial<LineState>, fallback: LineState) =>
    setState((previous) => ({ ...previous, [lineId]: { ...fallback, ...previous[lineId], ...next } }))

  const save = async () => {
    // The same three rules the server applies, so a driver in a dead zone is told now and not when
    // the batch finally syncs (AC-EXE-10).
    if (!receiverName.trim()) return setError(t('driver.needReceiver'))
    const signature = await pad.current?.toBlob()
    if (!signature && !photo) return setError(t('driver.needProof'))
    if (short && !note.trim()) return setError(t('driver.needShortNote'))
    setError(null)

    const attachmentUuids: string[] = []
    if (signature) attachmentUuids.push((await queueAttachment(signature, 'signature')).clientUuid)
    if (photo) attachmentUuids.push((await queueAttachment(photo, 'photo')).clientUuid)

    // The quantity carries the shortfall and the note says why. `condition` stays `ok`: D4 has no
    // per-line reason in the frame, and guessing between damaged and refused would put a claim in
    // the record that nobody made. A line that was damaged or refused outright belongs on D5.
    const recorded: QueuedLine[] = lines.map((line) => ({
      orderLineId: line.orderLineId,
      qtyDelivered: lineState(line).qty,
      condition: 'ok',
    }))

    await enqueue({
      kind: 'driver',
      type: outcome,
      tripId: stop.tripId,
      stopId: stop.id,
      outcome,
      receiverName: receiverName.trim(),
      note: note.trim() || undefined,
      lines: recorded,
      attachmentUuids,
      baseVersion: stop.version,
    })
    // The bytes follow on their own retry; the record is already safe on the phone.
    void flushAttachments({ type: 'stop', id: stop.id })

    const next = siblings.find((s) => s.status === 'PENDING' && s.id !== stop.id)
    void navigate(next ? `/driver/stops/${next.id}` : '/driver')
  }

  return (
    <>
      <header className="-mx-4 flex items-center gap-2.5 border-b border-border px-4 pb-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('driver.back')} className="size-11">
          <RouterLink to={`/driver/stops/${stop.id}`}>
            <Icon name="chevron-down" size={22} className="rotate-90" />
          </RouterLink>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="type-heading m-0 text-foreground">{t('driver.recordStop', { n: seq })}</h1>
          <p className="type-body m-0 truncate text-muted-foreground">{stop.outletName}</p>
        </div>
      </header>

      <section className="flex w-full flex-col">
        <p className="type-label m-0 pb-1 uppercase text-muted-foreground">{t('driver.unloadAndTick')}</p>
        {lines.map((line) => {
          const current = lineState(line)
          return (
            <div key={line.id} className="flex flex-col gap-2 border-t border-slate-100 pt-px">
              <div className="flex min-h-[49px] items-center gap-3">
                <Checkbox
                  checked={current.ticked}
                  onCheckedChange={(checked) =>
                    setLine(line.id, { ticked: checked === true, qty: checked === true ? line.qtyOrdered : 0 }, current)
                  }
                  aria-label={line.itemName}
                />
                <span className="type-field-label min-w-0 flex-1 text-foreground">{line.itemName}</span>
                <span className="type-data-bold whitespace-nowrap text-foreground">×{line.qtyOrdered}</span>
              </div>
              {current.ticked ? null : (
                <div className="flex items-center justify-between gap-3 pb-2 pl-9">
                  <span className="type-caption text-muted-foreground">
                    {t('driver.lineQty', { name: line.itemName })}
                  </span>
                  <QuantityStepper
                    value={current.qty}
                    onValueChange={(qty) => setLine(line.id, { qty, ticked: qty >= line.qtyOrdered }, current)}
                    min={0}
                    max={line.qtyOrdered}
                    label={line.itemName}
                  />
                </div>
              )}
            </div>
          )
        })}
      </section>

      <section className="flex w-full flex-col gap-1.5">
        <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.deliveredInFull')}</p>
        <SegmentedControl
          aria-label={t('driver.deliveredInFull')}
          className="h-[46px] w-full"
          options={[
            { value: 'yes', label: t('driver.yes') },
            { value: 'no', label: t('driver.noException') },
          ]}
          value={short ? 'no' : 'yes'}
          onValueChange={(value) => {
            if (value === 'no') void navigate(`/driver/stops/${stop.id}/exception`)
            else setState({})
          }}
        />
      </section>

      <section className="flex w-full flex-col gap-2">
        <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.proofOfDelivery')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-[50px] w-24 border-dashed bg-page text-[13px] font-normal text-muted-foreground"
            onClick={() => photoInput.current?.click()}
          >
            <Icon name="camera" size={18} />
            {photo ? '1' : t('driver.photo')}
          </Button>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={t('driver.photo')}
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
          <Input
            className="h-12 flex-1 text-[15px]"
            placeholder={t('driver.receiverName')}
            aria-label={t('driver.receiverName')}
            value={receiverName}
            onChange={(event) => setReceiverName(event.target.value)}
          />
        </div>
        <SignaturePad
          ref={pad}
          label={t('driver.signHere')}
          aria-label={t('driver.signature')}
          onDrawnChange={setSigned}
        />
        {short ? (
          <Input
            className="h-12 text-[15px]"
            placeholder={t('driver.shortNote')}
            aria-label={t('driver.shortNote')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        ) : null}
        {error ? (
          <p role="alert" className="type-caption m-0 text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </section>

      <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background px-4 pt-[13px] pb-2">
        <Action
          link={links.complete}
          onAction={save}
          variant="primary"
          className="h-[52px] w-full text-[16px]"
          data-proof={signed || photo ? 'ready' : 'none'}
        >
          {t('driver.saveStop')}
        </Action>
        <Button asChild variant="ghost" className="h-11 w-full text-[15px] text-slate-700">
          <RouterLink to={`/driver/stops/${stop.id}/exception`}>{t('driver.reportException')}</RouterLink>
        </Button>
      </footer>
    </>
  )
}
