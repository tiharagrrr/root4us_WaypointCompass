// Figma: A5 Vehicles · 185:9904 (the Edit action; no frame draws the dialog, so it follows A2)
import {
  getVehiclesListQueryKey,
  isApiProblem,
  useVehiclesUpdate,
  type UpdateVehicleDto,
  type VehicleDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { applyProblem } from '@/lib/apply-problem'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { toast } from '@/ui/toast-store'

interface EditForm {
  code: string
  registrationNo: string
  weightCapKg: string
  volumeCapM3: string
  fuelType: string
  kmPerL: string
  weeklyFuelQuotaL: string
}

const FIELDS = ['code', 'registrationNo', 'weightCapKg', 'volumeCapM3', 'fuelType', 'kmPerL', 'weeklyFuelQuotaL'] as const

export interface EditVehicleDialogProps {
  vehicle: VehicleDto
  onOpenChange: (open: boolean) => void
}

/**
 * The vehicle details an admin edits (AC-FLT-07). The write carries the
 * version the dialog opened on as If-Match, so a change someone else made in
 * the meantime answers 412 rather than overwriting theirs. The status is its
 * own dialog, because it needs a reason and tells planning to repair.
 */
export function EditVehicleDialog({ vehicle, onOpenChange }: EditVehicleDialogProps) {
  const queryClient = useQueryClient()
  const update = useVehiclesUpdate()
  const edit = getLink(vehicle._links, 'edit')
  const form = useForm<EditForm>({
    defaultValues: {
      code: vehicle.code,
      registrationNo: vehicle.registrationNo,
      weightCapKg: String(vehicle.weightCapKg),
      volumeCapM3: String(vehicle.volumeCapM3),
      fuelType: vehicle.fuelType,
      kmPerL: String(vehicle.kmPerL),
      weeklyFuelQuotaL: String(vehicle.weeklyFuelQuotaL),
    },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    const numbers: [keyof EditForm, string][] = [
      ['weightCapKg', values.weightCapKg],
      ['volumeCapM3', values.volumeCapM3],
      ['kmPerL', values.kmPerL],
      ['weeklyFuelQuotaL', values.weeklyFuelQuotaL],
    ]
    let bad = false
    for (const [field, draft] of numbers) {
      const n = Number(draft)
      if (draft.trim() === '' || Number.isNaN(n) || n < 0) {
        form.setError(field, { message: 'A number, please.' })
        bad = true
      }
    }
    if (bad) return

    const body: UpdateVehicleDto = {
      code: values.code.trim(),
      registrationNo: values.registrationNo.trim(),
      weightCapKg: Number(values.weightCapKg),
      volumeCapM3: Number(values.volumeCapM3),
      fuelType: values.fuelType.trim(),
      kmPerL: Number(values.kmPerL),
      weeklyFuelQuotaL: Number(values.weeklyFuelQuotaL),
    }

    try {
      await update.mutateAsync({ id: vehicle.id, data: body, headers: { 'If-Match': `W/"${vehicle.version}"` } })
    } catch (error) {
      if (!isApiProblem(error)) throw error
      if (error.code === 'VERSION_MISMATCH') {
        form.setError('root.server', { message: 'Someone else changed this vehicle. Close this and open it again.' })
        return
      }
      applyProblem(form, error, { fields: FIELDS })
      return
    }
    await queryClient.invalidateQueries({ queryKey: getVehiclesListQueryKey() })
    toast({ title: `${vehicle.code} saved`, description: 'Planning uses the new figures from the next run.', tone: 'success' })
    onOpenChange(false)
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={`Edit ${vehicle.code}`} description={`${vehicle.id} · depot ${vehicle.depotId}`} />
        <form noValidate onSubmit={(e) => void onSubmit(e)}>
          <DialogBody className="flex flex-col gap-4">
            {errors.root?.server ? (
              <p role="alert" className="type-caption m-0 text-destructive-foreground">
                {errors.root.server.message}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" hint="What the dock and the dispatcher call it." error={errors.code?.message}>
                {(control) => <Input {...control} {...form.register('code')} disabled={!edit} placeholder="REF-07" />}
              </Field>
              <Field label="Registration" error={errors.registrationNo?.message}>
                {(control) => <Input {...control} {...form.register('registrationNo')} disabled={!edit} />}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight capacity" hint="Kilograms." error={errors.weightCapKg?.message}>
                {(control) => <Input {...control} {...form.register('weightCapKg')} disabled={!edit} inputMode="decimal" />}
              </Field>
              <Field label="Volume capacity" hint="Cubic metres." error={errors.volumeCapM3?.message}>
                {(control) => <Input {...control} {...form.register('volumeCapM3')} disabled={!edit} inputMode="decimal" />}
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Fuel" error={errors.fuelType?.message}>
                {(control) => <Input {...control} {...form.register('fuelType')} disabled={!edit} placeholder="diesel" />}
              </Field>
              <Field label="Km per litre" error={errors.kmPerL?.message}>
                {(control) => <Input {...control} {...form.register('kmPerL')} disabled={!edit} inputMode="decimal" />}
              </Field>
              <Field label="Weekly quota" hint="Litres." error={errors.weeklyFuelQuotaL?.message}>
                {(control) => <Input {...control} {...form.register('weeklyFuelQuotaL')} disabled={!edit} inputMode="decimal" />}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {edit ? (
              <Button type="submit" variant="primary" loading={isSubmitting}>
                Save vehicle
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
