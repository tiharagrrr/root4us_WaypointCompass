// Figma: 03 Order queue · 185:12856 (the cancel step opens over the queue)
import { useOrdersCancel, type OrderDto } from '@compass/api-client'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { ErrorState } from '@/ui/states'
import { Textarea } from '@/ui/textarea'
import { CANCEL_REASONS } from './order-copy'

export interface CancelOrderDialogProps {
  order: OrderDto
  /** Re-reads the queue once the order is gone from it. */
  onCancelled: () => Promise<unknown> | unknown
  onClose: () => void
}

/**
 * A dispatcher cancelling one order off the queue. The server wants a `reasonCode` from a
 * dispatcher (a store sends `reasonNote` instead), and the order's version as `If-Match`, so a
 * queue left open while somebody else edited the order fails rather than overwriting them.
 */
export function CancelOrderDialog({ order, onCancelled, onClose }: CancelOrderDialogProps) {
  const [reasonCode, setReasonCode] = useState<string>('')
  const [note, setNote] = useState('')
  const cancel = useOrdersCancel()

  const submit = async () => {
    await cancel.mutateAsync({
      id: order.id,
      data: { reasonCode, ...(note.trim() ? { reasonNote: note.trim() } : {}) },
      headers: {
        'If-Match': `W/"${order.version}"`,
        'Idempotency-Key': globalThis.crypto.randomUUID(),
      },
    })
    await onCancelled()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader
          title={`Cancel ${order.orderNo}?`}
          description={`${order.outlet.name} · the store sees the cancellation and the reason.`}
        />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Reason">
            {(control) => (
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger {...control} aria-label="Reason">
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((reason) => (
                    <SelectItem key={reason.code} value={reason.code}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Note" hint="Optional, and the store reads it.">
            {(control) => (
              <Textarea
                {...control}
                value={note}
                maxLength={500}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Anything the store should know"
              />
            )}
          </Field>
          {cancel.isError ? <ErrorState error={cancel.error} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep order
          </Button>
          <Button
            variant="destructive"
            disabled={!reasonCode || cancel.isPending}
            onClick={() => void submit()}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
