// Figma: A5 Vehicles · 185:9904 (the Status action; also reached from 19 and the repair alert)
import {
  getVehiclesListQueryKey,
  isApiProblem,
  useVehicleStatusSetStatus,
  type VehicleDto,
  type VehicleStatus,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { VEHICLE_STATUS_LABELS } from '@/features/master-data/master-data-copy'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { RadioCards } from '@/ui/radio-cards'
import { Textarea } from '@/ui/textarea'
import { toast } from '@/ui/toast-store'

const OPTIONS = (Object.keys(VEHICLE_STATUS_LABELS) as VehicleStatus[]).map((value) => ({
  value,
  label: VEHICLE_STATUS_LABELS[value],
}))

export interface VehicleStatusDialogProps {
  vehicle: VehicleDto
  onOpenChange: (open: boolean) => void
}

/**
 * Takes a vehicle out of planning or brings it back, always with a reason
 * (AC-FLT-05, AC-FLT-06). A breakdown reaches planning as an event, which
 * offers the dispatcher a repair for the trips the vehicle was carrying.
 */
export function VehicleStatusDialog({ vehicle, onOpenChange }: VehicleStatusDialogProps) {
  const queryClient = useQueryClient()
  const setStatus = useVehicleStatusSetStatus()
  const link = getLink(vehicle._links, 'status')
  const [status, setStatusValue] = useState<VehicleStatus>(vehicle.status)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (reason.trim() === '') {
      setError('Say why, so the dispatcher and the audit trail know.')
      return
    }
    setError(null)
    try {
      await setStatus.mutateAsync({
        id: vehicle.id,
        data: { status, reason: reason.trim() },
        headers: { 'If-Match': `W/"${vehicle.version}"` },
      })
    } catch (problem) {
      if (!isApiProblem(problem)) throw problem
      setError(
        problem.code === 'VERSION_MISMATCH'
          ? 'Someone else changed this vehicle. Close this and open it again.'
          : (problem.errors[0]?.message ?? problem.detail ?? problem.title),
      )
      return
    }
    await queryClient.invalidateQueries({ queryKey: getVehiclesListQueryKey() })
    toast({
      title: `${vehicle.code} is ${VEHICLE_STATUS_LABELS[status].toLowerCase()}`,
      description: status === 'ACTIVE' ? 'It is back in planning.' : 'Planning offers to repair the trips it was carrying.',
      tone: 'success',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`${vehicle.code} status`}
          description="A vehicle that is not active leaves planning at once. The reason goes to the dispatcher and the audit trail."
        />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Status">
            {() => <RadioCards aria-label="Status" value={status} onValueChange={(next: VehicleStatus) => setStatusValue(next)} options={OPTIONS} />}
          </Field>
          <Field label="Reason" hint="Required." error={error ?? undefined}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={reason}
                placeholder={status === 'ACTIVE' ? 'Back from the workshop' : 'Compressor fault'}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {link ? (
            <Button type="button" variant="primary" loading={setStatus.isPending} onClick={() => void submit()}>
              Save status
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
