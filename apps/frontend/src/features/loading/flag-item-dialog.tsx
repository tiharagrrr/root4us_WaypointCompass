// Figma: L3 Flag an item · 185:19537 (the dialog on the tablet) and L3m Flag an item · 254:1605
// (the same fields filling a phone screen, with the two actions across the bottom)
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enqueue, useCheckedByName } from '@/offline'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { QuantityStepper } from '@/ui/quantity-stepper'
import { RadioCards } from '@/ui/radio-cards'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { FlagPhotoField } from './flag-photo-field'
import { FLAG_REASONS } from './loading-copy'
import type { LoadLineView } from './use-load-list'
import type { LoadFlagDtoReason } from '@compass/api-client'

export interface FlagItemDialogProps {
  tripId: string
  /** What the trip is called, for the dialog's subtitle. */
  tripRef: string
  /** Everything that can still be flagged; the item picker lists these. */
  lines: readonly LoadLineView[]
  /** The line the loader pressed Flag on. */
  line: LoadLineView
  onClose: () => void
}

const itemLabel = (line: LoadLineView): string =>
  `Stop ${line.stopSeq} · ${line.itemName ?? line.sku ?? line.orderNo} ×${line.qtyExpected}`

/**
 * L3. A flag is the loader's way of saying "this is not going to happen" and handing the decision
 * to the dispatcher, who replaces the item or removes it as a partial deferral — which is why the
 * dialog says plainly that release stays blocked until then.
 *
 * It goes through the outbox like every other loader write, so a flag raised with no signal is
 * still raised (AC-LOD-07, architecture rule 10).
 */
export function FlagItemDialog({ tripId, tripRef, lines, line, onClose }: FlagItemDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useCheckedByName()
  const flaggable = lines.filter((candidate) => candidate._links.flag)
  const [lineId, setLineId] = useState(line.id)
  const [reason, setReason] = useState<LoadFlagDtoReason | undefined>(undefined)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const chosen = flaggable.find((candidate) => candidate.id === lineId) ?? line
  const [qtyAffected, setQtyAffected] = useState(chosen.qtyExpected)
  const [raisedBy, setRaisedBy] = useState(name ?? '')

  const ready = Boolean(reason) && raisedBy.trim() !== ''

  const raise = async () => {
    if (!reason) return
    const raisedByName = raisedBy.trim()
    await setName(raisedByName)
    await enqueue({
      kind: 'loader',
      type: 'LOAD_FLAG_RAISED',
      tripId,
      loadLineId: chosen.id,
      reason,
      qtyAffected: Math.min(qtyAffected, chosen.qtyExpected),
      note: note.trim() === '' ? undefined : note.trim(),
      checkedByName: raisedByName,
      photoClientUuid: photo,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="inset-0 left-0 top-0 h-svh max-h-svh w-full max-w-none translate-x-0 rounded-none border-0 sm:inset-auto sm:bottom-auto sm:left-1/2 sm:top-[116px] sm:h-auto sm:max-h-[calc(100vh-140px)] sm:w-[522px] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:rounded-lg sm:border">
        <DialogHeader title={t('loading.flag.title')} description={tripRef} />
        <DialogBody className="gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground" id="flag-item-label">
              {t('loading.flag.item')}
            </p>
            <Select
              value={chosen.id}
              onValueChange={(next) => {
                setLineId(next)
                const picked = flaggable.find((candidate) => candidate.id === next)
                if (picked) setQtyAffected(picked.qtyExpected)
              }}
            >
              <SelectTrigger aria-labelledby="flag-item-label" className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {flaggable.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {itemLabel(candidate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground" id="flag-reason-label">
              {t('loading.flag.whatsWrong')}
            </p>
            <RadioCards
              size="touch"
              aria-labelledby="flag-reason-label"
              options={FLAG_REASONS.map((option) => ({ value: option.value, label: option.label }))}
              value={reason}
              onValueChange={setReason}
            />
          </div>

          {/* The API needs the quantity affected; the frame has room for it beside the reason. */}
          <div className="flex items-center justify-between gap-3">
            <p className="type-label m-0 uppercase text-muted-foreground">{t('loading.flag.howMany', { expected: chosen.qtyExpected })}</p>
            <QuantityStepper value={qtyAffected} onValueChange={setQtyAffected} min={1} max={chosen.qtyExpected} label={chosen.itemName ?? chosen.orderNo} />
          </div>

          <FlagPhotoField onPhoto={setPhoto} />

          <div className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground" id="flag-note-label">
              {t('loading.flag.note')}
            </p>
            <textarea
              aria-labelledby="flag-note-label"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('loading.flag.notePlaceholder')}
              className="type-body-small h-16 w-full resize-none rounded-md border border-input bg-background px-[13px] py-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="type-label m-0 uppercase text-muted-foreground" id="flag-raised-by">
              {t('loading.flag.raisedBy')}
            </p>
            <Input aria-labelledby="flag-raised-by" value={raisedBy} onChange={(event) => setRaisedBy(event.target.value)} className="h-12 text-[15px]" />
          </div>

          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-page px-[17px] py-[13px]">
            <p className="type-body-strong m-0 text-foreground">{t('loading.flag.blockedTitle')}</p>
            <p className="type-body m-0 text-slate-700">{t('loading.flag.blockedBody')}</p>
          </div>
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-[52px] w-[120px] text-[16px] sm:w-[140px]" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Action
            link={chosen._links.flag}
            disabled={!ready}
            className="h-[52px] flex-1 text-[16px]"
            onAction={() => raise()}
          >
            {t('loading.flag.submit')}
          </Action>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
