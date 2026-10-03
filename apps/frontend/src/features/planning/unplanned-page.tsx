// Figma: 15 Unplanned orders · 185:15715, step 3 of planning (16 Swap order is swap-dialog.tsx).
import {
  useDeferralReasonsList,
  usePlanBuildingDecide,
  type DeferralDecisionDto,
  type DeferralReasonDto,
  type UnplannedOrderDto,
} from '@compass/api-client'
import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Icon } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Textarea } from '@/ui/textarea'
import { PlanStepper } from './plan-chrome'
import { BRAND_GLYPH, dayLabel, kg } from './plan-copy'
import { SwapDialog } from './swap-dialog'
import { usePlanStep } from './use-plan-step'

const ordersWord = (n: number) => (n === 1 ? '1 order' : `${n} orders`)
const decided = (o: UnplannedOrderDto) => o.deferralStatus === 'CONFIRMED'

/** How much a store can wait, as the frame's Flexibility column says it. */
const flexibility = (o: UnplannedOrderDto) =>
  o.brand === 'STYLE' ? 'Weekly day' : o.brand === 'FRESH' && o.tempClass === 'CHILLED' ? 'Perishable' : 'Flexible'

/**
 * 15: every order no trip took. The dispatcher picks orders, records one reason and a note the
 * stores read, and defers them as one decision list (AC-PLN-16). A repeat skip needs a swap (16) or
 * an override note (AC-PLN-05, 18). The stores hear about it only when the plan is published.
 */
export function UnplannedPage() {
  const step = usePlanStep()
  const navigate = useNavigate()
  const { date, day, plan, unplanned } = step
  const reasons = (useDeferralReasonsList().data?.data ?? []).filter((r) => r.active)
  const decide = usePlanBuildingDecide()
  const [picked, setPicked] = useState<string[]>([])
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [swapping, setSwapping] = useState<UnplannedOrderDto | null>(null)

  const open = unplanned.filter((o) => !decided(o))
  const chosen = unplanned.filter((o) => picked.includes(o.orderId))
  // The reason is pre-filled from why the first picked order did not fit; the note from its store wording.
  const reasonCode = reason ?? chosen.find((o) => o.reasonCode)?.reasonCode ?? undefined
  const reasonRow = reasons.find((r) => r.code === reasonCode)
  const noteText = note ?? reasonRow?.description ?? ''
  const toDate = unplanned.find((o) => o.toDate)?.toDate
  const moveTo = toDate ? dayLabel(toDate) : 'the next run'
  const missingOverride = chosen.some((o) => o.repeatSkip && !overrides[o.orderId]?.trim())
  const still = open.filter((o) => !picked.includes(o.orderId))
  const ready = chosen.length > 0 && reasonCode !== undefined && noteText.trim() !== '' && !missingOverride

  usePageHeader({
    eyebrow: `PLAN · ${dayLabel(date).toUpperCase()} · ${open.length ? `${ordersWord(open.length).toUpperCase()} LEFT OVER` : 'ALL ORDERS DECIDED'}`,
    title: 'Unplanned orders',
  })

  const toggle = (id: string, on: boolean) => setPicked((now) => (on ? [...new Set([...now, id])] : now.filter((x) => x !== id)))

  const send = async (decisions: DeferralDecisionDto[]) => {
    if (!plan) return
    await decide.mutateAsync({
      id: plan.id,
      data: { decisions },
      headers: { 'If-Match': `W/"${plan.version}"`, 'Idempotency-Key': globalThis.crypto.randomUUID() },
    })
    await day.refresh()
  }

  const defer = async () => {
    if (!reasonCode) return
    await send(
      chosen.map((o) => ({
        orderId: o.orderId,
        action: 'DEFER',
        reasonCode,
        note: noteText.trim(),
        ...(o.repeatSkip ? { overrideNote: overrides[o.orderId]?.trim() } : {}),
      })),
    )
    setPicked([])
    setOverrides({})
    setNote(undefined)
    setReason(undefined)
  }

  return (
    <div className="-mx-6 -mb-4 -mt-4 flex min-h-0 flex-1 flex-col">
      <HeaderActions>
        <Button variant="outline" onClick={() => void navigate(`/dispatch/plan/${date}`)}>
          Back to plan
        </Button>
        {plan && open.length === 0 ? (
          <Button variant="primary" onClick={() => void navigate(`/dispatch/plan/${date}/publish`)}>
            Review and publish
          </Button>
        ) : null}
      </HeaderActions>
      <PlanStepper step={3} unplanned={open.length} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-page px-6 py-4">
        {day.plan.isError ? (
          <ErrorState error={day.plan.error} onRetry={() => void day.plan.refetch()} />
        ) : !plan || day.isPending ? (
          <Skeleton className="h-[640px] w-full" />
        ) : (
          <>
            <section className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
              <h2 className="type-card-title m-0 text-foreground">
                {open.length ? `${ordersWord(open.length)} didn’t fit any trip` : 'Every order left over has a decision'}
              </h2>
              <p className="type-body m-0 text-foreground">
                {open.length
                  ? `Defer them to ${moveTo} and tell the stores why, or go back to the plan to fit one in. Repeat skips need your decision before you can publish.`
                  : 'Review the day and publish it. The stores hear about their deferrals when you publish.'}
              </p>
            </section>

            <div className="flex items-start gap-4">
              <div className="flex min-w-px flex-1 flex-col gap-4">
                <section aria-label="Unplanned orders" className="rounded-lg border border-border bg-background">
                  <header className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h3 className="type-section m-0 text-foreground">Unplanned orders</h3>
                    <span className="type-label uppercase text-muted-foreground">{picked.length} selected to defer</span>
                  </header>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>#</TableHead>
                        <TableHead>Outlet</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Flexibility</TableHead>
                        <TableHead>Why it didn’t fit</TableHead>
                        <TableHead className="text-right">Load</TableHead>
                        <TableHead>Last run</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unplanned.map((o, i) => (
                        <Fragment key={o.orderId}>
                          <TableRow>
                            <TableCell>
                              {decided(o) ? (
                                <Icon name="check" size={16} className="text-muted-foreground" aria-label={`${o.orderNo} deferred`} />
                              ) : (
                                <Checkbox
                                  aria-label={`Defer ${o.orderNo}`}
                                  checked={picked.includes(o.orderId)}
                                  onCheckedChange={(on) => toggle(o.orderId, on === true)}
                                />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-[12px] font-bold text-muted-foreground">{String(i + 1).padStart(2, '0')}</TableCell>
                            <TableCell>
                              <Outlet order={o} />
                            </TableCell>
                            <TableCell>
                              <StatusChip tone="neutral">{o.tempClass === 'CHILLED' ? 'Chilled' : 'Ambient'}</StatusChip>
                            </TableCell>
                            <TableCell className="type-body">{flexibility(o)}</TableCell>
                            <TableCell className="type-body">{o.reasonLabel ?? 'Needs a decision'}</TableCell>
                            <TableCell className="text-right font-mono text-[12px] font-bold">{kg(o.weightKg)}</TableCell>
                            <TableCell>
                              {decided(o) ? (
                                <StatusChip tone="neutral">Decided</StatusChip>
                              ) : o.repeatSkip ? (
                                <StatusChip tone="danger">Deferred</StatusChip>
                              ) : (
                                <span className="type-body-small text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {o.repeatSkip && !decided(o) ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={8} className="pt-0">
                                <RepeatSkip
                                  order={o}
                                  overriding={overrides[o.orderId] !== undefined}
                                  overrideNote={overrides[o.orderId] ?? ''}
                                  onSwap={() => setSwapping(o)}
                                  onOverride={() => {
                                    setOverrides((now) => ({ ...now, [o.orderId]: now[o.orderId] ?? '' }))
                                    toggle(o.orderId, true)
                                  }}
                                  onNote={(text) => setOverrides((now) => ({ ...now, [o.orderId]: text }))}
                                />
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </section>

                {chosen.length ? (
                  <section aria-label="Stores told when you defer" className="rounded-lg border border-border bg-background">
                    <header className="border-b border-border px-4 py-3">
                      <h3 className="type-section m-0 text-foreground">Stores told when you defer</h3>
                      <p className="type-body-small m-0 text-muted-foreground">In the app when you publish, with the new date</p>
                    </header>
                    <ul className="m-0 list-none p-0">
                      {chosen.map((o) => (
                        <li key={o.orderId} className="flex items-center gap-4 border-t border-slate-100 px-4 py-2.5 first:border-t-0">
                          <span className="w-[240px]">
                            <Outlet order={o} compact />
                          </span>
                          <span className="type-body flex-1 text-muted-foreground">{reasonRow?.label ?? '—'}</span>
                          <StatusChip tone="neutral">{moveTo}</StatusChip>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>

              <ReasonPanel
                reasons={reasons}
                value={reasonCode}
                onChange={(code) => {
                  setReason(code)
                  setNote(undefined)
                }}
                note={noteText}
                onNote={setNote}
                count={chosen.length}
                moveTo={moveTo}
                still={still}
                ready={ready}
                busy={decide.isPending}
                onDefer={() => void defer().catch(() => undefined)}
              />
            </div>
            {decide.isError ? <ErrorState error={decide.error} /> : null}
          </>
        )}
      </div>

      {swapping && plan && day.engine ? (
        <SwapDialog
          order={swapping}
          engine={day.engine}
          trips={step.trips}
          reasons={reasons}
          busy={decide.isPending}
          onClose={() => setSwapping(null)}
          onSwap={async (decision) => {
            await send([decision])
            setSwapping(null)
          }}
        />
      ) : null}
    </div>
  )
}

function Outlet({ order, compact }: { order: UnplannedOrderDto; compact?: boolean }) {
  const glyph = BRAND_GLYPH[order.brand] ?? BRAND_GLYPH.FRESH
  return (
    <span className="flex flex-col gap-px">
      <span className="flex items-center gap-1.5 font-sans text-[13px] font-bold text-foreground">
        <Icon name={glyph.icon} size={14} className={glyph.className} />
        {order.outletName}
      </span>
      {compact ? null : <span className="type-mono-small text-muted-foreground">{order.orderNo}</span>}
    </span>
  )
}

interface RepeatSkipProps {
  order: UnplannedOrderDto
  overriding: boolean
  overrideNote: string
  onSwap: () => void
  onOverride: () => void
  onNote: (text: string) => void
}

/** The red row under a repeat skip: swap another order out (16), or override with a note. */
function RepeatSkip({ order, overriding, overrideNote, onSwap, onOverride, onNote }: RepeatSkipProps) {
  const glyph = BRAND_GLYPH[order.brand] ?? BRAND_GLYPH.FRESH
  return (
    <div className="flex flex-col gap-2 rounded-md border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-px flex-1 flex-col gap-0.5">
          <p className="type-body-medium m-0 flex items-center gap-1.5 font-bold text-status-danger-fg">
            <Icon name={glyph.icon} size={14} className={glyph.className} />
            {order.outletName} was deferred on the last run too
          </p>
          <p className="type-body-small m-0 text-foreground">Deferring again makes it 2 of 2 runs. Swap in another order, or override with a note.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onSwap}>
          Swap order
        </Button>
        {overriding ? null : (
          <Button variant="default" size="sm" onClick={onOverride}>
            Override
          </Button>
        )}
      </div>
      {overriding ? (
        <Textarea
          aria-label={`Why defer ${order.outletName} again`}
          placeholder="Why it waits another run. Kept on the audit trail."
          rows={2}
          value={overrideNote}
          onChange={(e) => onNote(e.target.value)}
        />
      ) : null}
    </div>
  )
}

interface ReasonPanelProps {
  reasons: readonly DeferralReasonDto[]
  value: string | undefined
  onChange: (code: string) => void
  note: string
  onNote: (text: string) => void
  count: number
  moveTo: string
  still: readonly UnplannedOrderDto[]
  ready: boolean
  busy: boolean
  onDefer: () => void
}

/** "Record reason": one reason and one note for every picked order. */
function ReasonPanel({ reasons, value, onChange, note, onNote, count, moveTo, still, ready, busy, onDefer }: ReasonPanelProps) {
  const repeat = still.filter((o) => o.repeatSkip).length
  const plain = still.filter((o) => !o.repeatSkip).map((o) => o.outletName)
  const stillWords = [...plain, ...(repeat ? [`${repeat} repeat skip${repeat === 1 ? '' : 's'}`] : [])]
  return (
    <section aria-label="Record reason" className="flex w-[318px] shrink-0 flex-col rounded-lg border border-border bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="type-section m-0 text-foreground">Record reason</h3>
        <StatusChip tone="neutral">Required</StatusChip>
      </header>
      <div className="flex flex-col gap-3 p-4">
        <p className="type-body-small m-0 text-muted-foreground">Pre-filled from why the selected orders didn’t fit.</p>
        <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-2">
          {reasons.map((r) => {
            const on = r.code === value
            return (
              <label
                key={r.code}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5',
                  on ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-slate-50',
                )}
              >
                <input type="radio" name="reason" className="mt-1 accent-primary" checked={on} onChange={() => onChange(r.code)} />
                <span className="flex flex-col gap-0.5">
                  <span className={cn('type-body-medium font-bold', on ? 'text-primary' : 'text-foreground')}>{r.label}</span>
                  {r.description ? <span className="type-body-small text-muted-foreground">{r.description}</span> : null}
                </span>
              </label>
            )
          })}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="type-label uppercase text-muted-foreground">Note to the store</span>
          <Textarea aria-label="Note to the store" placeholder="Visible to the store manager" rows={3} value={note} onChange={(e) => onNote(e.target.value)} />
        </label>
        <p className="type-body m-0 flex justify-between text-foreground">
          <span>Moves to {moveTo}</span>
          <span className="font-bold">{ordersWord(count)}</span>
        </p>
        {stillWords.length ? (
          <p className="type-body-medium m-0 font-bold text-status-danger-fg">Still to decide: {stillWords.join(', ')}.</p>
        ) : null}
        <Button variant="default" disabled={!ready} loading={busy} onClick={onDefer}>
          Defer {ordersWord(count)}
        </Button>
        <p className="type-body-small m-0 text-center text-muted-foreground">Logged to the audit trail.</p>
      </div>
    </section>
  )
}
