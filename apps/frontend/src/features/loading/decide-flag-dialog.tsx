// No Figma frame draws the dispatcher's side of L3b; 01 and 19 only show the alert's "Decide the
// flag" button (specs/loading/spec.md, the flag panel on 01 and 19). It uses M4's dialog layout and
// is logged in docs/departures.md.
import {
  getLoadFlagsGetQueryKey,
  getTripLoadingLoadListQueryKey,
  useDeferralReasonsList,
  useLoadFlagsDecide,
  useLoadFlagsGet,
  useTripLoadingLoadList,
  type LoadFlagDto,
  type LoadLineDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { RadioCards } from '@/ui/radio-cards'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Textarea } from '@/ui/textarea'
import { toast } from '@/ui/toast-store'
import { flagReasonLabel } from './loading-copy'

export interface DecideFlagDialogProps {
  flagId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Told once the decision is in, so the panel that opened this can refresh. */
  onDecided?: () => void
}

type Choice = 'REPLACE' | 'REMOVE'

const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'REPLACE', label: 'Replace', hint: 'The loader picks a new one and re-checks it.' },
  { value: 'REMOVE', label: 'Remove', hint: 'It stays off this trip. The missing quantity is deferred and the store is told.' },
]

/**
 * The dispatcher's answer to a flag (L3b, AC-LOD-10 and AC-LOD-12): what was flagged, by whom and
 * why, then Replace or Remove. Remove needs a reason the store can be told, taken from the
 * deferral reasons; the note is what the loader (Replace) or the store (Remove) reads. The form
 * shows only while the flag carries its `decide` link, so a flag someone already decided shows its
 * outcome and nothing to press.
 */
export function DecideFlagDialog({ flagId, open, onOpenChange, onDecided }: DecideFlagDialogProps) {
  const qc = useQueryClient()
  const flagQuery = useLoadFlagsGet(flagId, { query: { enabled: open } })
  const flag = flagQuery.data?.data
  const listQuery = useTripLoadingLoadList(flag?.tripId ?? '', { query: { enabled: open && Boolean(flag?.tripId) } })
  const reasons = useDeferralReasonsList({ query: { enabled: open } })
  const decide = useLoadFlagsDecide()

  const [choice, setChoice] = useState<Choice | undefined>()
  const [reasonCode, setReasonCode] = useState<string | undefined>()
  const [note, setNote] = useState('')

  const list = listQuery.data?.data
  const stop = list?.stops.find((s) => s.lines.some((l) => l.id === flag?.loadLineId))
  const line: LoadLineDto | undefined = stop?.lines.find((l) => l.id === flag?.loadLineId)
  const decideLink = getLink(flag?._links, 'decide')
  const activeReasons = (reasons.data?.data ?? []).filter((r) => r.active)

  const ready = choice !== undefined && (choice === 'REPLACE' || reasonCode !== undefined)

  const send = async () => {
    if (!choice || !flag) return
    await decide.mutateAsync({
      id: flag.id,
      data: {
        decision: choice,
        ...(choice === 'REMOVE' && reasonCode ? { reasonCode } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    })
    void qc.invalidateQueries({ queryKey: getLoadFlagsGetQueryKey(flag.id) })
    void qc.invalidateQueries({ queryKey: getTripLoadingLoadListQueryKey(flag.tripId) })
    void qc.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/v1/alerts'),
    })
    toast({
      title: choice === 'REPLACE' ? 'Replacement requested' : 'Item removed from the trip',
      description: choice === 'REPLACE' ? 'The dock tablet shows your reply now.' : 'The missing quantity is deferred and the store is told.',
      tone: 'success',
    })
    onOpenChange(false)
    onDecided?.()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !decide.isPending && onOpenChange(next)}>
      <DialogContent className="w-[520px] max-w-[calc(100vw-2rem)]">
        <DialogHeader
          title="Decide the flag"
          description={list && stop ? `${list.trip.vehicleId} · Stop ${stop.stopSeq} · ${stop.outletName}` : undefined}
        />
        {flagQuery.isError ? (
          <DialogBody>
            <ErrorState error={flagQuery.error} onRetry={() => void flagQuery.refetch()} />
          </DialogBody>
        ) : !flag ? (
          <DialogBody>
            <Skeleton className="h-[260px] w-full" />
          </DialogBody>
        ) : (
          <>
            <DialogBody className="max-h-[64vh]">
              <FlagSummary flag={flag} line={line} loadingLine={listQuery.isPending} />

              {decideLink ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span id="decision-label" className="type-label uppercase text-muted-foreground">
                      Your decision
                    </span>
                    <RadioCards<Choice>
                      aria-labelledby="decision-label"
                      value={choice}
                      onValueChange={setChoice}
                      options={CHOICES.map((c) => ({ value: c.value, label: c.label }))}
                    />
                    {choice ? <p className="type-body-small m-0 text-muted-foreground">{CHOICES.find((c) => c.value === choice)?.hint}</p> : null}
                  </div>

                  {choice === 'REMOVE' ? (
                    <Field label="Reason" hint="The store reads this on its deferral notice.">
                      {(control) => (
                        <Select value={reasonCode} onValueChange={setReasonCode}>
                          <SelectTrigger {...control} aria-label="Reason">
                            <SelectValue placeholder="Pick a reason" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeReasons.map((r) => (
                              <SelectItem key={r.code} value={r.code}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  ) : null}

                  <Field label={choice === 'REMOVE' ? 'Note for the store' : 'Message for the loader'}>
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={3}
                        maxLength={500}
                        placeholder={choice === 'REMOVE' ? 'What the store should know' : 'e.g. Load 1 new one from bay 4, then re-check it'}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                  </Field>
                  {decide.isError ? <ErrorState error={decide.error} /> : null}
                </>
              ) : (
                <DecidedSummary flag={flag} />
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" disabled={decide.isPending} onClick={() => onOpenChange(false)}>
                {decideLink ? 'Cancel' : 'Close'}
              </Button>
              {decideLink ? (
                <Button variant="default" loading={decide.isPending} disabled={!ready} onClick={() => void send()}>
                  Send decision
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** What was flagged, by whom and why, in the words the loader typed. */
function FlagSummary({ flag, line, loadingLine }: { flag: LoadFlagDto; line: LoadLineDto | undefined; loadingLine: boolean }) {
  return (
    <section aria-label="The flag" className="flex flex-col gap-2 rounded-md border border-border bg-page px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        {loadingLine ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <span className="type-body-medium font-bold text-foreground">{line?.itemName ?? 'An item'}</span>
        )}
        <StatusChip tone="danger">{flagReasonLabel(flag.reason)}</StatusChip>
      </div>
      <p className="type-body m-0 text-muted-foreground">
        {flag.qtyAffected}
        {line ? ` of ${line.qtyExpected}` : ''} affected{line?.packLabel ? ` · ${line.packLabel}` : ''}
        {line ? ` · order #${line.orderNo}` : ''}
      </p>
      {flag.note ? <p className="type-body m-0 text-foreground">“{flag.note}”</p> : null}
      <p className="type-body-small m-0 text-muted-foreground">
        Flagged by {flag.raisedByName} at {formatColombo(flag.raisedAt, 'HH:mm')}
      </p>
    </section>
  )
}

/** A flag that already has its answer: what it was, so a second dispatcher is not left guessing. */
function DecidedSummary({ flag }: { flag: LoadFlagDto }) {
  if (!flag.decision)
    return <p className="type-body m-0 text-muted-foreground">This flag has been closed without a decision.</p>
  return (
    <section aria-label="The decision" className="flex flex-col gap-1">
      <p className="type-body-medium m-0 font-bold text-foreground">
        {flag.decision === 'REPLACE' ? 'Replace requested' : 'Removed from the trip'}
        {flag.decidedAt ? ` · ${formatColombo(flag.decidedAt, 'HH:mm')}` : ''}
      </p>
      {flag.decisionNote ? <p className="type-body m-0 text-muted-foreground">“{flag.decisionNote}”</p> : null}
    </section>
  )
}
