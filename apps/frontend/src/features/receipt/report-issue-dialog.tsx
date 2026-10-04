// Figma: M6 Report issue · 185:11543, a dialog over the store's Receipts list.
import {
  getIssuesListQueryKey,
  getOrdersListQueryKey,
  getReceiptsGetQueryKey,
  useIssuesCreate,
  useReceiptsConfirm,
  useReceiptsGet,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Icon } from '@/ui/icon'
import { QuantityStepper } from '@/ui/quantity-stepper'
import { RadioCards } from '@/ui/radio-cards'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { Textarea } from '@/ui/textarea'
import { toast } from '@/ui/toast-store'
import { uploadIssuePhoto } from './issue-photo'
import { CONDITION_OF, ISSUE_TYPE_WORDS, losesPacks, REPORT_TYPES, type ReportType } from './receipt-copy'

export interface ReportIssueDialogProps {
  orderId: string
  onClose: () => void
}

/** What M5's "Report an issue" hands over: the line to start from and a first guess at the kind. */
interface Preset {
  orderLineId?: string
  type?: ReportType
}

/**
 * M6: what is wrong, with which item, how many packs, a photo and a note, sent to the dispatcher.
 * Before the store has confirmed, this one send also confirms the other lines as received and
 * opens the issue (AC-RCP-02); after, it raises the issue on the received order (AC-RCP-10). Either
 * way the dispatcher follows up with a credit or a re-delivery.
 */
export function ReportIssueDialog({ orderId, onClose }: ReportIssueDialogProps) {
  const queryClient = useQueryClient()
  const preset = ((useLocation().state as Preset | null) ?? {}) satisfies Preset
  const read = useReceiptsGet(orderId)
  const confirm = useReceiptsConfirm()
  const create = useIssuesCreate()
  const receipt = read.data?.data
  const [type, setType] = useState<ReportType>(preset.type ?? 'SHORT')
  const [lineId, setLineId] = useState<string | undefined>(preset.orderLineId)
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const line = receipt?.lines.find((l) => l.orderLineId === lineId) ?? receipt?.lines[0]
  const baseline = line ? (line.qtyDelivered ?? line.qtyExpected) : 1
  const count = Math.min(Math.max(qty, 1), Math.max(baseline, 1))
  const confirmLink = getLink(receipt?._links, 'confirm')
  const canReport = Boolean(confirmLink) || Boolean(getLink(receipt?._links, 'reportIssue'))
  const delivered = receipt?.proof.deliveredAt ? formatColombo(receipt.proof.deliveredAt, 'HH:mm') : null
  const error = confirm.error ?? create.error

  const send = async () => {
    if (!receipt || !line) return
    const idempotencyKey = globalThis.crypto.randomUUID()
    const description = note.trim()
    setSending(true)
    try {
      let issueId: string | undefined
      if (confirmLink) {
        // Not confirmed yet: this line carries the problem, every other line arrived as delivered.
        const res = await confirm.mutateAsync({
          id: orderId,
          data: {
            lines: receipt.lines.map((l) =>
              l.orderLineId === line.orderLineId
                ? {
                    orderLineId: l.orderLineId,
                    qtyReceived: Math.max(baseline - (losesPacks(type) ? count : 0), 0),
                    condition: CONDITION_OF[type],
                    qtyAffected: count,
                    note: description,
                  }
                : { orderLineId: l.orderLineId, qtyReceived: l.qtyDelivered ?? l.qtyExpected, condition: 'ok' },
            ),
            note: description,
          },
          headers: { 'If-Match': `W/"${receipt.version}"`, 'Idempotency-Key': idempotencyKey },
        })
        issueId = res.data.issueIds[0]
      } else {
        const res = await create.mutateAsync({
          data: { orderId, orderLineId: line.orderLineId, type, qtyAffected: count, description },
          headers: { 'If-Match': `W/"${receipt.version}"`, 'Idempotency-Key': idempotencyKey },
        })
        issueId = res.data.id
      }
      if (photo && issueId) {
        await uploadIssuePhoto(issueId, photo).catch(() =>
          toast({ title: 'The photo didn’t upload', description: 'Your report was sent without it.', tone: 'danger' }),
        )
      }
      void queryClient.invalidateQueries({ queryKey: getReceiptsGetQueryKey(orderId) })
      void queryClient.invalidateQueries({ queryKey: getOrdersListQueryKey() })
      void queryClient.invalidateQueries({ queryKey: getIssuesListQueryKey() })
      toast({ title: 'Sent to the dispatcher', description: `Order #${receipt.orderNo}`, tone: 'success' })
      onClose()
    } catch {
      // The mutations hold the error and the dialog shows it.
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[460px] max-w-[calc(100vw-2rem)]">
        <DialogHeader
          title="Report issue"
          description={receipt ? [`Order #${receipt.orderNo}`, delivered ? `delivered ${delivered}` : null].filter(Boolean).join(' · ') : undefined}
        />
        {read.isError ? (
          <div className="p-5">
            <ErrorState error={read.error} onRetry={() => void read.refetch()} />
          </div>
        ) : !receipt || !line ? (
          <div className="p-5">
            <Skeleton className="h-[360px] w-full" />
          </div>
        ) : !canReport ? (
          <div className="p-5">
            <p className="type-body m-0 text-foreground">This order can’t have an issue reported yet. Report one once it has been delivered.</p>
          </div>
        ) : (
          <>
            <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-1.5">
                <span id="what-wrong" className="type-label uppercase text-muted-foreground">
                  What’s wrong?
                </span>
                <RadioCards<ReportType>
                  aria-labelledby="what-wrong"
                  value={type}
                  onValueChange={setType}
                  options={REPORT_TYPES.map((t) => ({ value: t, label: ISSUE_TYPE_WORDS[t] }))}
                />
              </div>

              <Field label="Item">
                {(control) => (
                  <Select value={line.orderLineId} onValueChange={setLineId}>
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {receipt.lines.map((l) => (
                        <SelectItem key={l.orderLineId} value={l.orderLineId}>
                          {l.name} · {l.packLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <div className="flex items-center justify-between gap-3">
                <span className="type-label uppercase text-muted-foreground">Quantity affected</span>
                <QuantityStepper label={line.name} value={count} onValueChange={setQty} min={1} max={Math.max(baseline, 1)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="type-label uppercase text-muted-foreground">Photo</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Add photo"
                  className="sr-only"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex h-[74px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-page text-slate-600 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Icon name="camera" />
                  <span className="type-body-medium">{photo ? photo.name : 'Add photo'}</span>
                </button>
              </div>

              <Field label="Note" hint="The dispatcher follows up with a credit or a re-delivery.">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    placeholder="What happened, in a sentence"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
              {error ? <ErrorState error={error} /> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={sending} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="default" loading={sending} disabled={note.trim() === ''} onClick={() => void send()}>
                Send to dispatcher
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
