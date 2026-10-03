// Figma: M4 Deferral notice · 185:11128, a dialog over M3 (and M7).
import {
  getDeferralsGetQueryKey,
  getDeferralsListQueryKey,
  useDeferralsGet,
  useDeferralsList,
  useDeferralsRespond,
  useOrdersCancel,
  useOrdersGet,
  type DeferralDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogHeader } from '@/ui/dialog'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Textarea } from '@/ui/textarea'
import { brandWord } from '@/features/ordering/order-copy'
import { dayLabel } from '@/features/ordering/order-format'
import { RESPONSE_WORDS } from './deferral-copy'

export interface DeferralNoticeProps {
  id: string
  onClose: () => void
}

/**
 * M4: why an order moved, in the store's words and the dispatcher's note (never the engine's
 * numbers, AC-PLN-16), and the store's one answer: acknowledge, or ask for priority with a note
 * (AC-PLN-27). Both show only while the deferral carries its `respond` link; the order's own
 * links decide whether it can still be edited or cancelled.
 */
export function DeferralNotice({ id, onClose }: DeferralNoticeProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const read = useDeferralsGet(id)
  const respond = useDeferralsRespond()
  const cancel = useOrdersCancel()
  const [answer, setAnswer] = useState<DeferralDto | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const deferral = answer ?? read.data?.data
  const order = useOrdersGet(deferral?.orderId ?? '', undefined, { query: { enabled: Boolean(deferral) } }).data?.data
  const history = useDeferralsList(
    { 'filter[orderId]': deferral?.orderId, sort: '-createdAt', limit: 10 },
    { query: { enabled: Boolean(deferral) } },
  ).data?.data
  const respondLink = getLink(deferral?._links, 'respond')

  const send = async (response: 'ACKNOWLEDGED' | 'PRIORITY_REQUESTED', idempotencyKey: string) => {
    const res = await respond.mutateAsync({
      id,
      data: response === 'PRIORITY_REQUESTED' ? { response, note: note.trim() } : { response },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    setAnswer(res.data)
    queryClient.setQueryData(getDeferralsGetQueryKey(id), res)
    void queryClient.invalidateQueries({ queryKey: getDeferralsListQueryKey() })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[460px]">
        <DialogHeader title="Deferral notice" description={deferral ? `Order #${deferral.orderNo} moved to the next run` : undefined} />
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 pb-5">
          {read.isError ? (
            <ErrorState error={read.error} onRetry={() => void read.refetch()} />
          ) : !deferral ? (
            <Skeleton className="h-[320px] w-full" />
          ) : (
            <>
              <dl className="m-0 flex flex-col">
                <Row label="Order">{order ? `${brandWord(order.brand)} · ${order.tempClass === 'CHILLED' ? 'Chilled' : 'Dry'}` : deferral.orderNo}</Row>
                <Row label="Reason">{deferral.reasonText ?? deferral.reasonLabel}</Row>
                <Row label="Was">
                  <span className="text-muted-foreground line-through">{dayLabel(deferral.fromDate)}</span>
                </Row>
                <Row label="New run">
                  {dayLabel(deferral.toDate)}
                  {order ? ` · ${order.deliveryWindow.open}–${order.deliveryWindow.close}` : ''}
                </Row>
              </dl>

              {deferral.note ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="type-label m-0 uppercase text-muted-foreground">Note from dispatcher</h3>
                  <p className="type-body m-0 rounded-md border border-border bg-page px-3.5 py-3 text-foreground">{deferral.note}</p>
                  {deferral.decidedAt ? (
                    <p className="type-body-small m-0 text-muted-foreground">{formatColombo(deferral.decidedAt, 'EEE d MMM, HH:mm')}</p>
                  ) : null}
                </section>
              ) : null}

              {history && history.length > 1 ? (
                <section className="flex flex-col">
                  <h3 className="type-label m-0 pb-1.5 uppercase text-muted-foreground">Deferral history</h3>
                  {history.map((d) => (
                    <div key={d.id} className="flex items-center justify-between border-t border-slate-100 py-2.5">
                      <span className="flex flex-col">
                        <span className="type-body-medium font-bold text-foreground">{dayLabel(d.fromDate)}</span>
                        <span className="type-body-small text-muted-foreground">{d.reasonLabel}</span>
                      </span>
                      {d.repeatSkip ? <StatusChip tone="danger">Repeat skip</StatusChip> : null}
                    </div>
                  ))}
                </section>
              ) : null}

              <section className="flex flex-col gap-2 border-t border-border pt-4">
                {respondLink ? (
                  <>
                    <h3 className="type-card-title m-0 text-foreground">Does the new date work?</h3>
                    <Action
                      link={respondLink}
                      variant="default"
                      loading={respond.isPending && !asking}
                      onAction={({ idempotencyKey }) => send('ACKNOWLEDGED', idempotencyKey)}
                    >
                      Acknowledge · adjust staff
                    </Action>
                  </>
                ) : (
                  <p className="type-body-medium m-0 font-bold text-foreground">{RESPONSE_WORDS[deferral.storeResponse] ?? 'Answered'}</p>
                )}
                {deferral.storeNote ? <p className="type-body m-0 text-muted-foreground">“{deferral.storeNote}”</p> : null}

                {order && (getLink(order._links, 'edit') || getLink(order._links, 'cancel')) ? (
                  <div className="grid grid-cols-2 gap-2">
                    {getLink(order._links, 'edit') ? (
                      <Button variant="outline" onClick={() => void navigate('/store/orders/new')}>
                        Edit order
                      </Button>
                    ) : null}
                    <Action
                      link={order._links.cancel}
                      variant="outline"
                      version={order.version}
                      confirm={{ title: `Cancel order #${order.orderNo}?`, description: 'It leaves the queue and no run will carry it.', confirmLabel: 'Cancel order' }}
                      onAction={({ idempotencyKey }) =>
                        cancel
                          .mutateAsync({
                            id: order.id,
                            data: {},
                            headers: { 'If-Match': `W/"${order.version}"`, 'Idempotency-Key': idempotencyKey },
                          })
                          .then(onClose)
                      }
                    >
                      Cancel order
                    </Action>
                  </div>
                ) : null}

                {respondLink ? (
                  asking ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        aria-label="Why it needs priority"
                        rows={3}
                        placeholder="What happens if it waits, for the dispatcher"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <Action
                        link={respondLink}
                        variant="outline"
                        disabled={note.trim() === ''}
                        onAction={({ idempotencyKey }) => send('PRIORITY_REQUESTED', idempotencyKey)}
                      >
                        Ask for priority
                      </Action>
                    </div>
                  ) : (
                    <Button variant="link" onClick={() => setAsking(true)}>
                      Request priority with a note
                    </Button>
                  )
                ) : null}
                {respond.isError || cancel.isError ? <ErrorState error={respond.error ?? cancel.error} /> : null}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5">
      <dt className="type-body text-muted-foreground">{label}</dt>
      <dd className="type-body-medium m-0 text-right font-bold text-foreground">{children}</dd>
    </div>
  )
}
