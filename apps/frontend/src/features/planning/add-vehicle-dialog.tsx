// Figma: 06 Add vehicle · Vehicle · 265:2419, 07 Add vehicle · Orders · 488:9309, 08 Add vehicle ·
// Check · 267:2216: one dialog, three steps. On a saved vehicle it is 10 View and edit vehicle ·
// 488:9736 (and 11 Over capacity · 269:2996): the orders step only, saved straight to the plan.
import { usePlanBuildingEdit, usePlanBuildingValidate, type PlanDto, type ViolationDto } from '@compass/api-client'
import type { EditOp, FixSuggestion } from '@waypoint/engine'
import { type ReactNode, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { canTakeTrip, kg, percent, vehicleKind } from './plan-copy'
import { RevisionReasonBar, type RevisionReason } from './revision-reason'
import { editsFor, fixesFor, previewDraft, savedOrders, type TripDraft } from './trip-draft'
import type { PlanDay } from './use-plan-day'
import { CheckStep } from './wizard-check-step'
import { OrdersStep } from './wizard-orders-step'
import { VehicleStep } from './wizard-vehicle-step'

export interface WizardStart {
  vehicleId?: string
  tripNo?: number
}

export interface AddVehicleDialogProps {
  day: PlanDay
  plan: PlanDto
  depotName: string
  /** Where to open: a vehicle and trip from 09's "View and edit", or {} for a new vehicle. */
  start: WizardStart
  onClose: () => void
}

type Step = 1 | 2 | 3

/**
 * The 06 → 07 → 08 wizard. It holds one trip as a draft, runs the engine in the browser on every
 * change (07), asks the server to check the edits (08), and saves them as one edit list with the
 * plan's version, so a second dispatcher's change in between is refused (AC-PLN-07, 13).
 */
export function AddVehicleDialog({ day, plan, depotName, start, onClose }: AddVehicleDialogProps) {
  const engine = day.engine
  const vehicles = day.vehicles.data?.data ?? []
  // Opening from 09 lands on the vehicle's trip; a new vehicle starts on 06. The page mounts the
  // dialog afresh for each opening, so this runs once.
  const [step, setStep] = useState<Step>(start.vehicleId ? 2 : 1)
  const [target, setTarget] = useState<{ vehicleId: string; tripNo: number } | null>(
    start.vehicleId ? { vehicleId: start.vehicleId, tripNo: start.tripNo ?? 1 } : null,
  )
  // The trip's orders once the dispatcher has changed them; null while it is as the plan saved it.
  const [picked, setPicked] = useState<readonly string[] | null>(null)
  const vehicle = vehicles.find((v) => v.vehicleId === target?.vehicleId)
  // Worked out from the target on every render, so a dialog opened before the engine context has
  // loaded fills in when it arrives instead of staying empty.
  const draft = useMemo<TripDraft | null>(() => {
    if (!target || !vehicle || !engine) return null
    const base = { vehicleId: target.vehicleId, vehicleCode: vehicle.code, tripNo: target.tripNo }
    return { ...base, orderIds: picked ?? savedOrders(engine.plan, base) }
  }, [target, vehicle, engine, picked])
  const [introduced, setIntroduced] = useState<ViolationDto[] | undefined>(undefined)
  const validate = usePlanBuildingValidate()
  const save = usePlanBuildingEdit()
  // 10: a vehicle already on the plan. Its changes save straight to the plan, with no check step.
  const editing = start.vehicleId !== undefined
  // After publish every save is a revision and needs a reason (AC-PLN-21).
  const revising = plan.status === 'PUBLISHED'
  const [reason, setReason] = useState<RevisionReason>({ note: '' })
  const needsReason = revising && !reason.reasonCode

  /** Picks a vehicle's trip. Picking the one already open keeps the orders put on it so far. */
  const begin = (vehicleId: string, tripNo?: number) => {
    const no = tripNo ?? vehicles.find((v) => v.vehicleId === vehicleId)?.nextTripNo ?? 1
    if (target?.vehicleId === vehicleId && target.tripNo === no) return
    setTarget({ vehicleId, tripNo: no })
    setPicked(null)
  }
  // The driver the plan already has on this vehicle's trips (AC-PLN-40); none before its first save.
  const driverName = (day.trips.data?.data ?? []).find((t) => t.vehicleId === target?.vehicleId && t.driverName)?.driverName ?? undefined

  const preview = useMemo(
    () => (engine && draft ? previewDraft(engine.input, engine.plan, draft) : undefined),
    [engine, draft],
  )
  const ops = useMemo(() => (engine && draft ? editsFor(engine.input, engine.plan, draft) : []), [engine, draft])

  const outletNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const o of day.unplanned.data?.data ?? []) names.set(o.outletId, o.outletName)
    for (const t of day.trips.data?.data ?? []) for (const s of t.stops) names.set(s.outletId, s.outletName)
    return names
  }, [day.unplanned.data, day.trips.data])
  const outletName = (id: string | undefined) => (id ? outletNames.get(id) : undefined)

  const check = async () => {
    setStep(3)
    setIntroduced(undefined)
    if (ops.length === 0) return setIntroduced([])
    const res = await validate.mutateAsync({ id: plan.id, data: { ops } })
    setIntroduced(res.data.introduced)
  }

  const send = async (edits: readonly EditOp[]) => {
    await save.mutateAsync({
      id: plan.id,
      data: {
        ops: [...edits],
        ...(revising ? { reasonCode: reason.reasonCode, ...(reason.note.trim() ? { note: reason.note.trim() } : {}) } : {}),
      },
      headers: { 'If-Match': `W/"${plan.version}"`, 'Idempotency-Key': globalThis.crypto.randomUUID() },
    })
    await day.refresh()
  }

  const commit = async (another: boolean) => {
    if (ops.length) await send(ops)
    if (another) {
      setTarget(null)
      setPicked(null)
      setIntroduced(undefined)
      setStep(1)
    } else onClose()
  }

  /** 11: the draft and the fix as one edit list; the trip then shows what the plan now holds. */
  const applyFix = async (fix: FixSuggestion) => {
    if (!engine || !draft) return
    const edits: EditOp[] = [...ops, ...fix.edits]
    await send(edits)
    const after = preview?.next ?? engine.plan
    const moved = new Set(fix.edits.flatMap((e) => ('orderId' in e && e.op !== 'ASSIGN_ORDER' ? [e.orderId] : [])))
    setPicked(savedOrders(after, draft).filter((id) => !moved.has(id)))
  }

  /** 10: every trip of this vehicle comes off the plan, and its orders go back to the list. */
  const removeVehicle = async () => {
    if (!engine || !draft) return
    const keys = engine.plan.trips.filter((t) => t.vehicleId === draft.vehicleId).map((t) => `${draft.vehicleCode}#${t.tripNo}`)
    if (keys.length) await send(keys.map((tripKey): EditOp => ({ op: 'REMOVE_TRIP', tripKey })))
    onClose()
  }

  const fixes = useMemo(
    () => (engine && preview?.problems[0] ? fixesFor(engine.input, preview.next, preview.problems[0]) : []),
    [engine, preview],
  )

  const trip = preview?.trip
  const orders = draft?.orderIds.length ?? 0
  const full = vehicle && trip ? Math.max(percent(trip.weightKg, vehicle.weightCapKg), percent(trip.volumeM3, vehicle.volumeCapM3)) : 0
  const blocked = (introduced ?? []).some((v) => v.severity === 'HARD')
  const title = editing && vehicle ? `${vehicle.code} · ${vehicleKind(vehicle.type, vehicle.temp)}` : step === 1 || !vehicle ? 'Add vehicle' : `Add vehicle · ${vehicle.code}`

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={cn('top-1/2 -translate-y-1/2', step === 2 ? 'w-[1220px]' : 'w-[822px]')}>
        <DialogHeader
          title={title}
          description={
            editing
              ? 'View and edit this vehicle. Changes save straight to the plan.'
              : step === 1
                ? 'Pick the vehicle for this trip. Each vehicle runs up to 2 trips a day.'
                : step === 2
                  ? `Add orders to Trip ${target?.tripNo ?? 1}. The first order sets the brand and district.`
                  : `Check Trip ${target?.tripNo ?? 1} before you save it.`
          }
        />
        <WizardSteps step={step} editing={editing} onStep={setStep} />

        <div className="min-h-0 overflow-y-auto">
          {step === 1 ? (
            <VehicleStep vehicles={vehicles} selected={target?.vehicleId} onSelect={(id) => begin(id)} />
          ) : null}
          {step === 2 && engine && draft && vehicle && preview ? (
            <OrdersStep
              input={engine.input}
              plan={engine.plan}
              vehicle={vehicle}
              depotName={depotName}
              driverName={driverName}
              draft={draft}
              preview={preview}
              outletName={outletName}
              onChange={setPicked}
              onPickTrip={(tripNo) => begin(draft.vehicleId, tripNo)}
              editing={
                editing
                  ? { fixes, onApplyFix: (fix) => void applyFix(fix).catch(() => undefined), applying: save.isPending || needsReason }
                  : undefined
              }
            />
          ) : null}
          {step === 2 && !(engine && draft && vehicle && preview) ? (
            day.context.isError ? (
              <div className="px-5 py-3.5">
                <ErrorState error={day.context.error} onRetry={() => void day.context.refetch()} />
              </div>
            ) : (
              <div className="flex items-start gap-4 px-5 py-3.5" aria-busy="true">
                <Skeleton className="h-[120px] w-[200px]" />
                <Skeleton className="h-[320px] w-[340px]" />
                <Skeleton className="h-[320px] min-w-px flex-1" />
              </div>
            )
          ) : null}
          {step === 3 && draft && vehicle ? (
            <CheckStep
              vehicle={vehicle}
              tripNo={draft.tripNo}
              trip={trip}
              districtName={trip ? (engine?.input.districts[trip.districtId]?.name ?? trip.districtId) : ''}
              depotName={depotName}
              stopNames={(trip?.stops ?? []).map((s) => outletName(engine?.input.orders.find((o) => o.id === s.orderId)?.outletId) ?? s.orderId)}
              introduced={validate.isError ? [] : introduced}
            />
          ) : null}
          {validate.isError || save.isError ? (
            <div className="px-5 pb-3">
              <ErrorState error={save.error ?? validate.error} />
            </div>
          ) : null}
        </div>

        {revising && (editing || step === 3) ? <RevisionReasonBar revision={plan.revision} value={reason} onChange={setReason} /> : null}

        {editing ? (
          <DialogFooter className="justify-between">
            <Button variant="outline" disabled={needsReason} loading={save.isPending} onClick={() => void removeVehicle().catch(() => undefined)}>
              Remove from plan
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={ops.length === 0 || (preview?.problems.length ?? 0) > 0 || needsReason}
                loading={save.isPending}
                onClick={() => void commit(false).catch(() => undefined)}
              >
                Save changes
              </Button>
            </div>
          </DialogFooter>
        ) : (
        <DialogFooter className="justify-between">
          <p className="type-mono-small m-0 text-muted-foreground">
            {step === 1
              ? vehicle && target
                ? `${vehicle.code} · Trip ${target.tripNo} · from ${depotName}`
                : 'Pick a vehicle'
              : step === 2
                ? `${orders} orders · ${kg(trip?.weightKg ?? 0)} · ${full}% full`
                : 'You can edit this trip from the plan later.'}
          </p>
          <div className="flex gap-2">
            {step === 1 ? (
              <>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={!vehicle || !canTakeTrip(vehicle)} onClick={() => setStep(2)}>
                  Next: add orders
                </Button>
              </>
            ) : step === 2 ? (
              <>
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="primary" disabled={ops.length === 0} loading={validate.isPending} onClick={() => void check()}>
                  Save Trip
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  variant="outline"
                  disabled={blocked || introduced === undefined || needsReason}
                  loading={save.isPending}
                  onClick={() => void commit(true).catch(() => undefined)}
                >
                  Save and add another vehicle
                </Button>
                <Button
                  variant="primary"
                  disabled={blocked || introduced === undefined || needsReason}
                  loading={save.isPending}
                  onClick={() => void commit(false).catch(() => undefined)}
                >
                  Save Trip
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The dialog's own three steps: done ones in black with a tick, the current one in blue. While a
 * new trip is being built a done step is a way back to it, so the vehicle can still be changed.
 */
function WizardSteps({ step, editing, onStep }: { step: Step; editing: boolean; onStep: (step: Step) => void }) {
  const steps = ['Vehicle', 'Orders', 'Check'] as const
  return (
    <ol className="m-0 flex list-none items-center gap-3 border-b border-border px-5 py-3">
      {steps.map((label, i) => {
        const n = (i + 1) as Step
        const done = n < step
        const current = n === step
        return (
          <li key={label} className="flex items-center gap-3">
            {i > 0 ? <span aria-hidden="true" className="h-px w-10 bg-slate-300" /> : null}
            <StepLabel current={current} onClick={done && !editing ? () => onStep(n) : undefined} label={label}>
              <span
                className={cn(
                  'flex size-[22px] items-center justify-center rounded-full font-mono text-[13px] font-bold',
                  done ? 'bg-default text-primary-foreground' : current ? 'bg-primary text-primary-foreground' : 'border border-slate-300 bg-background text-muted-foreground',
                )}
              >
                {done ? '✓' : n}
              </span>
              <span className={cn('type-body-medium', done || current ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            </StepLabel>
          </li>
        )
      })}
      <li aria-hidden="true" className="flex-1" />
      <li className="type-label uppercase text-muted-foreground">{editing ? 'Editing a saved vehicle' : `Step ${step} of 3`}</li>
    </ol>
  )
}

function StepLabel({ current, onClick, label, children }: { current: boolean; onClick?: () => void; label: string; children: ReactNode }) {
  return onClick ? (
    <button
      type="button"
      aria-label={`Back to ${label}`}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-0 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {children}
    </button>
  ) : (
    <span className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
      {children}
    </span>
  )
}
