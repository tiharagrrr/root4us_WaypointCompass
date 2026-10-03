// Figma: 23 Deferrals · 185:18890, "Reply to store" (the frame draws the button; the dialog is ours).
import { getDeferralsListQueryKey, isApiProblem, useDeferralsReply, type DeferralDto } from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { ErrorState } from '@/ui/states'
import { Textarea } from '@/ui/textarea'
import { toast } from '@/ui/toast-store'
import { placeName } from './deferral-copy'

/**
 * The dispatcher's one reply to the store about a deferral (AC-PLN-35). The store reads it on M4
 * under its own note. One Idempotency-Key per dialog, so a retried send replays.
 */
export function ReplyDialog({ deferral: d, onClose }: { deferral: DeferralDto; onClose: () => void }) {
  const queryClient = useQueryClient()
  const reply = useDeferralsReply()
  const [text, setText] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const [key] = useState(() => globalThis.crypto.randomUUID())

  const send = async () => {
    setFieldError(undefined)
    try {
      await reply.mutateAsync({ id: d.id, data: { text: text.trim() }, headers: { 'Idempotency-Key': key } })
      void queryClient.invalidateQueries({ queryKey: getDeferralsListQueryKey() })
      toast({ title: `Reply sent to ${placeName(d.outletName)}`, tone: 'success' })
      onClose()
    } catch (error) {
      // A problem about the text goes under the field; anything else shows below it.
      if (isApiProblem(error)) setFieldError(error.errors.find((e) => e.field === 'text')?.message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !reply.isPending && onClose()}>
      <DialogContent className="w-[460px]">
        <DialogHeader title="Reply to store" description={`${placeName(d.outletName)} reads this with order ${d.orderNo}.`} />
        <DialogBody>
          {d.storeNote ? <p className="type-body m-0 rounded-md border border-border bg-page px-3.5 py-3 text-foreground">“{d.storeNote}”</p> : null}
          <Field label="Your reply" error={fieldError}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                maxLength={500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What you are doing about it"
              />
            )}
          </Field>
          {reply.isError && !fieldError ? <ErrorState error={reply.error} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={reply.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" loading={reply.isPending} disabled={text.trim() === ''} onClick={() => void send()}>
            Send reply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
