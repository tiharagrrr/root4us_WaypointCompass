// Figma: 19b Re-sequence stops · 464:2353, the Defer… button on each stop (and 19's Defer stop).
import { useDeferralReasonsList, useTripOperationsDeferStop, type PlanStopDto } from '@compass/api-client'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { ErrorState } from '@/ui/states'
import { Textarea } from '@/ui/textarea'
import { toast } from '@/ui/toast-store'

export interface DeferStopDialogProps {
  tripId: string
  stop: PlanStopDto
  /** The trip's version, for If-Match. */
  version: number
  onClose: () => void
  onDone: () => void
}

/**
 * Takes one stop still to come off the trip (AC-PLN-25): its order waits for the next run with
 * this reason, and the store reads the reason and the note. A stop the driver has reached cannot be
 * deferred; the server says so.
 */
export function DeferStopDialog({ tripId, stop, version, onClose, onDone }: DeferStopDialogProps) {
  const reasons = (useDeferralReasonsList().data?.data ?? []).filter((r) => r.active)
  const defer = useTripOperationsDeferStop()
  const [reasonCode, setReasonCode] = useState<string | undefined>(undefined)
  const [note, setNote] = useState('')
  const [key] = useState(() => globalThis.crypto.randomUUID())

  const send = async () => {
    await defer.mutateAsync({
      id: tripId,
      stopId: stop.id,
      data: { reasonCode, ...(note.trim() ? { note: note.trim() } : {}) },
      headers: { 'If-Match': `W/"${version}"`, 'Idempotency-Key': key },
    })
    toast({ title: `${stop.outletName} moved to the next run`, description: 'The store is told why.', tone: 'success' })
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !defer.isPending && onClose()}>
      <DialogContent className="w-[460px]">
        <DialogHeader title={`Defer ${stop.outletName}`} description={`${stop.orderNo} comes off this trip and goes on the next run.`} />
        <DialogBody>
          <Field label="Reason">
            {(control) => (
              <Select value={reasonCode ?? ''} onValueChange={setReasonCode}>
                <SelectTrigger {...control} aria-label="Reason">
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Note for the store" hint="Optional">
            {(control) => <Textarea {...control} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {defer.isError ? <ErrorState error={defer.error} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={defer.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" disabled={!reasonCode} loading={defer.isPending} onClick={() => void send().catch(() => undefined)}>
            Defer stop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
