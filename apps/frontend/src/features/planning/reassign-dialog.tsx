// Figma: 20 Reassign trip · 185:17727
import { useTripOperationsReassign, type DriverOptionDto, type PlanVehicleOptionDto, type TripDto } from '@compass/api-client'
import { RadioGroup } from 'radix-ui'
import { useState } from 'react'
import type { Link } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { BRAND_WORD, clock, kg, vehicleKind } from './plan-copy'
import { RevisionReasonBar, type RevisionReason } from './revision-reason'

export interface ReassignDialogProps {
  trip: TripDto
  vehicles: readonly PlanVehicleOptionDto[]
  /** The depot's drivers (GET /plans/{id}/driver-options). */
  drivers: readonly DriverOptionDto[]
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

const KEEP = 'keep'

/**
 * 20: the trip moves to another vehicle with its stops, another driver takes it, or both; it keeps
 * its id. A released trip on another vehicle goes back to the dock to be loaded again; a driver
 * change alone leaves it released (AC-PLN-23). The loader, the stores and the driver are told.
 */
export function ReassignDialog({ trip, vehicles, drivers, link, version, revision, because, onClose, onDone }: ReassignDialogProps) {
  const options = vehicles.filter((v) => v.vehicleId !== trip.vehicleId)
  // The options load after the dialog opens, so the first vehicle that fits is the default until
  // the dispatcher picks one.
  const first = options.find((v) => fitOf(trip, v).tone === 'success')
  const [chosen, setVehicleId] = useState<string | undefined>(undefined)
  const vehicleId = chosen ?? first?.vehicleId ?? KEEP
  const [driverId, setDriverId] = useState<string | undefined>(trip.driverId ?? undefined)
  const [reason, setReason] = useState<RevisionReason>({ note: '' })
  const [key] = useState(() => globalThis.crypto.randomUUID())
  const reassign = useTripOperationsReassign()
  const picked = options.find((v) => v.vehicleId === vehicleId)
  const live = trip.stops.filter((s) => s.status !== 'CANCELLED')
  const firstWindow = Math.min(...live.map((s) => s.windowOpenMin))
  const newVehicle = vehicleId !== KEEP
  const newDriver = driverId !== undefined && driverId !== trip.driverId
  const driver = drivers.find((d) => d.driverId === driverId)

  const apply = async () => {
    await reassign.mutateAsync({
      id: trip.id,
      data: {
        ...(newVehicle ? { vehicleId } : {}),
        ...(newDriver ? { driverId } : {}),
        reasonCode: reason.reasonCode,
        ...(reason.note.trim() ? { note: reason.note.trim() } : {}),
      },
      headers: { 'If-Match': `W/"${version}"`, 'Idempotency-Key': key },
    })
    toast({
      title: newVehicle ? `${trip.vehicleCode} trip moved to ${picked?.code ?? 'the new vehicle'}` : `${driver?.name ?? 'The new driver'} takes ${trip.vehicleCode}`,
      tone: 'success',
    })
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !reassign.isPending && onClose()}>
      <DialogContent className="w-[644px]">
        <DialogHeader title={`Reassign ${trip.vehicleCode} · Trip ${trip.tripNo ?? 1}`} description={because ?? 'Move this trip, with its stops, to another vehicle or driver.'} />
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-1">
            <h3 className="type-label m-0 uppercase text-muted-foreground">Trip load</h3>
            <p className="type-body m-0 text-foreground">
              {live.length} stops · {BRAND_WORD[trip.brand] ?? trip.brand} · {kg(trip.loadWeightKg)} · {trip.loadVolumeM3.toFixed(1)} m³
              {live.length ? ` · first window ${clock(firstWindow)}` : ''}
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 id="move-to" className="type-label m-0 uppercase text-muted-foreground">
              Move to
            </h3>
            <RadioGroup.Root aria-labelledby="move-to" value={vehicleId} onValueChange={setVehicleId} className="flex flex-col gap-2">
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
              <RadioGroup.Item
                value={KEEP}
                aria-label={`Keep ${trip.vehicleCode}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:border-blue-700 data-[state=checked]:bg-accent"
              >
                <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-input group-data-[state=checked]:border-[5px] group-data-[state=checked]:border-blue-700" />
                <span className="type-body text-foreground">Keep {trip.vehicleCode}; change only the driver</span>
              </RadioGroup.Item>
            </RadioGroup.Root>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="type-label m-0 uppercase text-muted-foreground">Driver</h3>
            <Select value={driverId ?? ''} onValueChange={setDriverId}>
              <SelectTrigger aria-label="Driver">
                <SelectValue placeholder="Pick a driver" />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.driverId} value={d.driverId}>
                    {d.name} · {d.driverId === trip.driverId ? 'on this trip' : d.tripsOnPlan === 0 ? 'on shift, no trip' : `${d.tripsOnPlan} trip${d.tripsOnPlan === 1 ? '' : 's'} today`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
          <p className="type-body-small m-0 text-muted-foreground">
            The loader at the dock, the stores on this trip and the driver are told. A released trip is loaded again on a new vehicle.
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
            disabled={(!newVehicle && !newDriver) || !reason.reasonCode}
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
