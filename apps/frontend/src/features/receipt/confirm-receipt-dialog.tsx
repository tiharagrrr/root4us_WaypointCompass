// Figma: M5 Confirm receipt · 185:11384, a dialog over the store's Receipts list.
import {
  getOrdersListQueryKey,
  getReceiptsGetQueryKey,
  useReceiptsConfirm,
  useReceiptsGet,
  type ReceiptDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { ProofImage } from './proof-image'

export interface ConfirmReceiptDialogProps {
  orderId: string
  onClose: () => void
}

const timeOf = (instant: string | null) => (instant ? formatColombo(instant, 'HH:mm') : null)

/**
 * M5: the store ticks each line against what the driver left (the driver's signature and photo sit
 * beside it), then confirms. A line left unticked can't be confirmed as received: "Report an
 * issue" opens M6 for it instead, which confirms the rest and raises the issue in one step
 * (AC-RCP-02). The confirm button exists only while the receipt carries its `confirm` link, so a
 * delivery that has not happened yet (AC-RCP-05) or is already confirmed (AC-RCP-08) shows none.
 */
export function ConfirmReceiptDialog({ orderId, onClose }: ConfirmReceiptDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const read = useReceiptsGet(orderId)
  const confirm = useReceiptsConfirm()
  const receipt = read.data?.data
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  const confirmLink = getLink(receipt?._links, 'confirm')
  const done = receipt !== undefined && receipt.status !== 'PENDING'
  const isTicked = (lineId: string) => done || ticked.has(lineId)
  const total = receipt?.lines.length ?? 0
  const count = receipt ? receipt.lines.filter((l) => isTicked(l.orderLineId)).length : 0

  const toggle = (lineId: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(lineId)
      else next.delete(lineId)
      return next
    })

  const reportIssue = () => {
    const first = receipt?.lines.find((l) => !isTicked(l.orderLineId)) ?? receipt?.lines[0]
    void navigate(`/store/orders/${orderId}/issue`, { state: { orderLineId: first?.orderLineId, type: 'SHORT' } })
  }

  const send = async (r: ReceiptDto, version: number, idempotencyKey: string) => {
    await confirm.mutateAsync({
      id: orderId,
      data: {
        lines: r.lines.map((l) => ({ orderLineId: l.orderLineId, qtyReceived: l.qtyDelivered ?? l.qtyExpected, condition: 'ok' })),
      },
      headers: { 'If-Match': `W/"${version}"`, 'Idempotency-Key': idempotencyKey },
    })
    void queryClient.invalidateQueries({ queryKey: getReceiptsGetQueryKey(orderId) })
    void queryClient.invalidateQueries({ queryKey: getOrdersListQueryKey() })
    toast({ title: 'Receipt confirmed', description: `Order #${r.orderNo} is received.`, tone: 'success' })
    onClose()
  }

  const delivered = timeOf(receipt?.proof.deliveredAt ?? null)

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[720px] max-w-[calc(100vw-2rem)]">
        <DialogHeader
          title="Confirm receipt"
          description={receipt ? [delivered ? `Delivered ${delivered}` : 'Not delivered yet', `Order #${receipt.orderNo}`].join(' · ') : undefined}
        />
        {read.isError ? (
          <div className="p-5">
            <ErrorState error={read.error} onRetry={() => void read.refetch()} />
          </div>
        ) : !receipt ? (
          <div className="p-5">
            <Skeleton className="h-[320px] w-full" />
          </div>
        ) : (
          <>
            <div className="grid max-h-[62vh] grid-cols-[1fr_1fr] gap-x-6 overflow-y-auto px-5 py-4">
              <section aria-label="Driver’s proof of delivery" className="flex flex-col gap-3">
                <h3 className="type-label m-0 uppercase text-muted-foreground">Driver’s proof of delivery</h3>
                <div className="flex items-center justify-between border-t border-border py-2.5">
                  <span className="type-body text-muted-foreground">Received by</span>
                  <span className="type-body-medium font-bold text-foreground">{receipt.proof.receiverName ?? '—'}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="type-label uppercase text-muted-foreground">Signature</span>
                  <ProofImage id={receipt.proof.signature?.id ?? null} label="Signature" empty="NO SIGNATURE YET" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="type-label uppercase text-muted-foreground">Photo</span>
                  <ProofImage id={receipt.proof.photo?.id ?? null} label="Photo" empty={delivered ? `POD PHOTO · ${delivered}` : 'NO PHOTO YET'} />
                </div>
                {receipt.awaitingDriverSync ? (
                  <p className="type-body-small m-0 rounded-md border border-status-warning-border bg-page px-3 py-2.5 text-foreground">
                    You confirmed before the driver’s record arrived. This completes by itself when the driver’s phone syncs.
                  </p>
                ) : confirmLink && !receipt.proof.deliveredAt ? (
                  <p className="type-body-small m-0 rounded-md border border-border bg-page px-3 py-2.5 text-foreground">
                    The driver’s record hasn’t arrived yet. You can confirm now that the ETA has passed.
                  </p>
                ) : null}
              </section>

              <section aria-label="Check items against the order" className="flex flex-col">
                <h3 className="type-label m-0 pb-2 uppercase text-muted-foreground">Check items against the order</h3>
                {receipt.lines.map((line) => (
                  <label key={line.orderLineId} className="flex cursor-pointer items-start gap-3 border-t border-border py-3">
                    <Checkbox
                      aria-label={line.name}
                      checked={isTicked(line.orderLineId)}
                      disabled={done}
                      onCheckedChange={(on) => toggle(line.orderLineId, on === true)}
                    />
                    <span className="flex min-w-px flex-1 flex-col">
                      <span className="type-body-medium font-bold text-foreground">{line.name}</span>
                      <span className="type-body-small text-muted-foreground">{line.packLabel}</span>
                      {done && line.condition && line.condition !== 'ok' ? (
                        <span className="type-body-small text-destructive-foreground">
                          {line.condition} · {line.qtyReceived} of {line.qtyDelivered ?? line.qtyExpected}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[14px] font-bold text-foreground">×{line.qtyDelivered ?? line.qtyExpected}</span>
                  </label>
                ))}
                <p className="type-label m-0 border-t border-border pt-2.5 font-mono uppercase text-muted-foreground">
                  {count} of {total} checked
                </p>
              </section>
            </div>
            {confirm.isError ? (
              <div className="px-5 pb-3">
                <ErrorState error={confirm.error} />
              </div>
            ) : null}
            <DialogFooter className="justify-between">
              {confirmLink || getLink(receipt._links, 'reportIssue') ? (
                <Button variant="outline" onClick={reportIssue}>
                  Report an issue
                </Button>
              ) : (
                <span />
              )}
              {confirmLink ? (
                <Action
                  link={confirmLink}
                  variant="primary"
                  version={receipt.version}
                  disabled={count < total}
                  onAction={({ idempotencyKey }) => send(receipt, receipt.version, idempotencyKey)}
                >
                  All received · confirm
                </Action>
              ) : done ? (
                <StatusChip tone={receipt.status === 'CONFIRMED' ? 'success' : 'danger'}>
                  {receipt.status === 'CONFIRMED' ? 'Confirmed' : 'Confirmed with issues'}
                  {receipt.confirmedAt ? ` · ${timeOf(receipt.confirmedAt)}` : ''}
                </StatusChip>
              ) : (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
