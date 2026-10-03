// Figma: D8 Can't run this trip · 185:20441
import type { CantRunReason } from '@waypoint/shared'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enqueue, type CachedTrip } from '@/offline'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { RadioCards } from '@/ui/radio-cards'
import { Textarea } from '@/ui/textarea'
import { flushAttachments, queueAttachment } from './attachments'
import { cachedTripLinks } from './offline-links'

const REASONS: readonly CantRunReason[] = ['BREAKDOWN', 'COOLING', 'UNWELL', 'OTHER']
const LABELS: Record<CantRunReason, string> = {
  BREAKDOWN: 'driver.reasonBreakdown',
  COOLING: 'driver.reasonCooling',
  UNWELL: 'driver.reasonUnwell',
  OTHER: 'driver.reasonOther',
}

export interface CantRunDialogProps {
  trip: CachedTrip | undefined
  /** The server's link while the trip list is in hand; offline the cached status decides. */
  serverLinks?: unknown
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The one event that cannot wait for the next batch. A driver who says she cannot run the trip has
 * started a clock: the dispatcher has to find another vehicle or another driver before the stores
 * open, so `enqueue` marks CANT_RUN urgent and the sync engine sends it the moment there is any
 * connection at all (AC-EXE-14).
 *
 * The reason is required, in the server's own words, and the trip keeps its vehicle and driver
 * until a dispatcher reassigns it — the phone only reports.
 */
export function CantRunDialog({ trip, serverLinks, open, onOpenChange }: CantRunDialogProps) {
  const { t } = useTranslation()
  const [reasonCode, setReasonCode] = useState<CantRunReason | undefined>()
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement | null>(null)

  const link = trip ? cachedTripLinks(trip).cantRun : getLink(serverLinks, 'cantRun')

  const send = async () => {
    if (!trip) return
    if (!reasonCode) return setError(t('driver.needReason'))
    setError(null)

    const attachmentUuids: string[] = []
    if (photo) attachmentUuids.push((await queueAttachment(photo, 'photo')).clientUuid)

    await enqueue({
      kind: 'driver',
      type: 'CANT_RUN',
      tripId: trip.id,
      reasonCode,
      note: note.trim() || undefined,
      attachmentUuids,
      baseVersion: trip.version,
    })
    if (photo)
      void flushAttachments(
        { type: 'trip', id: trip.id },
        { kinds: { photo: 'CANT_RUN_PHOTO', signature: 'SIGNATURE' } },
      )
    onOpenChange(false)
  }

  const departs = trip?.departsAt ? formatColombo(trip.departsAt, 'HH:mm') : '—'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[72px] max-h-[calc(100svh-96px)]">
        <DialogHeader
          title={t('driver.cantRunTitle')}
          description={t('driver.cantRunSubtitle', { ref: trip?.tripRef ?? '', time: departs })}
        />
        <DialogBody className="gap-3.5 p-4">
          <section className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.whatsStoppingYou')}</p>
            <RadioCards
              aria-label={t('driver.whatsStoppingYou')}
              className="grid-cols-1"
              options={REASONS.map((value) => ({ value, label: t(LABELS[value]) }))}
              value={reasonCode}
              onValueChange={setReasonCode}
            />
          </section>

          <section className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.photoOptional')}</p>
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

          <section className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground">{t('driver.note')}</p>
            <Textarea
              className="h-[72px]"
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
        </DialogBody>
        <DialogFooter className="flex-col items-stretch gap-2 px-4">
          <Action link={link} onAction={send} variant="default" className="h-[52px] w-full text-[16px]">
            {t('driver.sendToDispatcher')}
          </Action>
          <p className="type-caption m-0 text-center text-muted-foreground">{t('driver.cantRunFooter')}</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
