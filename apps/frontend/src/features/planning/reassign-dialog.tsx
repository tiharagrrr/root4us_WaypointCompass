// Figma: 20 Reassign trip · 185:17727
import { useTripOperationsReassign, type PlanVehicleOptionDto, type TripDto } from '@compass/api-client'
import { RadioGroup } from 'radix-ui'
import { useState } from 'react'
import type { Link } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { BRAND_WORD, kg, vehicleKind } from './plan-copy'
import { RevisionReasonBar, type RevisionReason } from './revision-reason'

export interface ReassignDialogProps {
  trip: TripDto
  vehicles: readonly PlanVehicleOptionDto[]
  /** The trip's `reassign` link; the dialog exists only when the trip carries it. */
  link: Link
  version: number
  revision: number
  /** Why the trip needs another vehicle, when the driver said (Can't run). */
  because?: string | null
  onClose: () => void
  onDone: () => void
}

type Fit = { label: string; tone: 'success' | 'danger' }

/**
 * How a vehicle looks for this trip at a glance, from the options the plan already sends. The
 * server's engine has the final say when the dispatcher presses Reassign (AC-PLN-23).
 */
function fitOf(trip: TripDto, v: PlanVehicleOptionDto): Fit {
  if (!v.available) return { label: v.unavailableReason ?? 'Unavailable', tone: 'danger' }
  if (trip.tempClass === 'CHILLED' && v.temp !== 'REEFER') return { label: 'Needs a reefer', tone: 'danger' }
  if (v.tripsLeft < 1) return { label: 'No trips left', tone: 'danger' }
  if (v.weightCapKg < trip.loadWeightKg || v.volumeCapM3 < trip.loadVolumeM3) return { label: 'Too small', tone: 'danger' }
  return { label: 'Fits', tone: 'success' }
}

/**
 * 20: the trip moves to another vehicle with its stops, keeping its id. A released trip goes back
 * to the dock to be loaded again; the loader, the stores and the driver are told.
 */
export function ReassignDialog({ trip, vehicles, link, version, revision, because, onClose, onDone }: ReassignDialogProps) {
  const options = vehicles.filter((v) => v.vehicleId !== trip.vehicleId)
  // The options load after the dialog opens, so the first vehicle that fits is the default until
  // the dispatcher picks one.
  const first = options.find((v) => fitOf(trip, v).tone === 'success')
  const [chosen, setVehicleId] = useState<string | undefined>(undefined)
  const vehicleId = chosen ?? first?.vehicleId
  const [reason, setReason] = useState<RevisionReason>({ note: '' })
  const [key] = useState(() => globalThis.crypto.randomUUID())
  const reassign = useTripOperationsReassign()
  const picked = options.find((v) => v.vehicleId === vehicleId)
  const live = trip.stops.filter((s) => s.status !== 'CANCELLED')
  const firstWindow = live.map((s) => s.window.open).sort()[0]

  const apply = async () => {
    if (!vehicleId) return
    await reassign.mutateAsync({
      id: trip.id,
      data: { vehicleId, reasonCode: reason.reasonCode, ...(reason.note.trim() ? { note: reason.note.trim() } : {}) },
      headers: { 'If-Match': `W/"${version}"`, 'Idempotency-Key': key },
    })
    toast({ title: `${trip.vehicleCode} trip moved to ${picked?.code ?? 'the new vehicle'}`, tone: 'success' })
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !reassign.isPending && onClose()}>
      <DialogContent className="w-[644px]">
        <DialogHeader title={`Reassign ${trip.vehicleCode} · Trip ${trip.tripNo ?? 1}`} description={because ?? 'Move this trip, with its stops, to another vehicle.'} />
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-1">
            <h3 className="type-label m-0 uppercase text-muted-foreground">Trip load</h3>
            <p className="type-body m-0 text-foreground">
              {live.length} stops · {BRAND_WORD[trip.brand] ?? trip.brand} · {kg(trip.loadWeightKg)} · {trip.loadVolumeM3.toFixed(1)} m³
              {firstWindow ? ` · first window ${firstWindow}` : ''}
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 id="move-to" className="type-label m-0 uppercase text-muted-foreground">
              Move to
            </h3>
            <RadioGroup.Root aria-labelledby="move-to" value={vehicleId ?? ''} onValueChange={setVehicleId} className="flex flex-col gap-2">
              {options.map((v) => {
                const fit = fitOf(trip, v)
                return (
                  <RadioGroup.Item
                    key={v.vehicleId}
                    value={v.vehicleId}
                    aria-label={v.code}
                    disabled={fit.tone === 'danger'}
                    className="group flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70 data-[state=checked]:border-blue-700 data-[state=checked]:bg-accent"
                  >
                    <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-input group-data-[state=checked]:border-[5px] group-data-[state=checked]:border-blue-700" />
                    <span className="flex items-center gap-1.5 rounded-md border border-border bg-page px-2 py-1 font-mono text-[12px]">
                      <Icon name="vehicles" size={14} className="text-slate-500" />
                      <strong>{v.code}</strong> {vehicleKind(v.type, v.temp)}
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span className="type-body text-foreground">{v.available ? `Available · ${v.tripsLeft} trip${v.tripsLeft === 1 ? '' : 's'} left` : 'Not available'}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {(v.weightCapKg / 1000).toFixed(1)} t · {v.volumeCapM3} m³
                      </span>
                    </span>
                    <StatusChip tone={fit.tone}>{fit.label}</StatusChip>
                  </RadioGroup.Item>
                )
              })}
            </RadioGroup.Root>
            {options.length === 0 ? <p className="type-body m-0 text-muted-foreground">No other vehicle at this depot.</p> : null}
          </section>
          <p className="type-body-small m-0 text-muted-foreground">
            The loader at the dock, the stores on this trip and the driver are told. A released trip is loaded again on the new vehicle.
          </p>
          {reassign.isError ? <ErrorState error={reassign.error} /> : null}
        </div>
        <RevisionReasonBar revision={revision} value={reason} onChange={setReason} />
        <DialogFooter>
          <Button variant="outline" disabled={reassign.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            title={link.title}
            disabled={!vehicleId || !reason.reasonCode}
            loading={reassign.isPending}
            onClick={() => void apply().catch(() => undefined)}
          >
            Reassign and notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
