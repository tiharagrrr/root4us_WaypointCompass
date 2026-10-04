// Figma: A3 Outlets · 185:9392 (the Edit action; no frame draws the dialog, so it follows A2)
import {
  getOutletsListQueryKey,
  isApiProblem,
  useOutletsUpdate,
  type DockType,
  type OutletDto,
  type ParkingConstraint,
  type UpdateOutletDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { applyProblem } from '@/lib/apply-problem'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { toast } from '@/ui/toast-store'
import { DOCK_LABELS, PARKING_LABELS } from './master-data-copy'
import { MINUTE_HINT, minuteLabel, parseMinute } from './minutes'

interface EditForm {
  dockType: DockType
  parkingConstraint: ParkingConstraint
  windowOpen: string
  windowClose: string
  mallWindowOpen: string
  mallWindowClose: string
  receivingContactName: string
  receivingContactPhone: string
  accessNotes: string
}

export interface EditOutletDialogProps {
  outlet: OutletDto
  onOpenChange: (open: boolean) => void
}

const trimmed = (value: string): string | null => (value.trim() === '' ? null : value.trim())

/**
 * The outlet edits A3 makes: the delivery window, the mall window, dock and
 * parking, the receiving contact and the access notes D9 shows the driver. The
 * window rules are the server's (AC-MD-01); a refusal lands on its field.
 */
export function EditOutletDialog({ outlet, onOpenChange }: EditOutletDialogProps) {
  const queryClient = useQueryClient()
  const update = useOutletsUpdate()
  const edit = getLink(outlet._links, 'edit')
  const form = useForm<EditForm>({
    defaultValues: {
      dockType: outlet.dockType,
      parkingConstraint: outlet.parkingConstraint,
      windowOpen: minuteLabel(outlet.windowOpenMin),
      windowClose: minuteLabel(outlet.windowCloseMin),
      mallWindowOpen: minuteLabel(outlet.mallWindowOpenMin),
      mallWindowClose: minuteLabel(outlet.mallWindowCloseMin),
      receivingContactName: outlet.receivingContactName ?? '',
      receivingContactPhone: outlet.receivingContactPhone ?? '',
      accessNotes: outlet.accessNotes ?? '',
    },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    /** A time field that is filled but unreadable never reaches the server. */
    const times: [keyof EditForm, string][] = [
      ['windowOpen', values.windowOpen],
      ['windowClose', values.windowClose],
      ['mallWindowOpen', values.mallWindowOpen],
      ['mallWindowClose', values.mallWindowClose],
    ]
    let bad = false
    for (const [field, draft] of times) {
      const required = field === 'windowOpen' || field === 'windowClose'
      if (draft.trim() === '' && !required) continue
      if (parseMinute(draft) === null) {
        form.setError(field, { message: `Use ${MINUTE_HINT}.` })
        bad = true
      }
    }
    if (bad) return

    const body: UpdateOutletDto = {
      dockType: values.dockType,
      parkingConstraint: values.parkingConstraint,
      windowOpenMin: parseMinute(values.windowOpen) ?? outlet.windowOpenMin,
      windowCloseMin: parseMinute(values.windowClose) ?? outlet.windowCloseMin,
      mallWindowOpenMin: parseMinute(values.mallWindowOpen),
      mallWindowCloseMin: parseMinute(values.mallWindowClose),
      receivingContactName: trimmed(values.receivingContactName),
      receivingContactPhone: trimmed(values.receivingContactPhone),
      accessNotes: trimmed(values.accessNotes),
    }

    try {
      await update.mutateAsync({ id: outlet.id, data: body })
    } catch (error) {
      if (!isApiProblem(error)) throw error
      // The server names the minute column; the form holds the label field.
      const fieldOf: Record<string, string> = {
        windowOpenMin: 'windowOpen',
        windowCloseMin: 'windowClose',
        mallWindowOpenMin: 'mallWindowOpen',
        mallWindowCloseMin: 'mallWindowClose',
      }
      applyProblem(
        form,
        { ...error, errors: error.errors.map((e) => ({ ...e, field: fieldOf[e.field] ?? e.field })) },
        { fields: ['windowOpen', 'windowClose', 'mallWindowOpen', 'mallWindowClose', 'dockType', 'parkingConstraint', 'receivingContactName', 'receivingContactPhone', 'accessNotes'] },
      )
      return
    }
    await queryClient.invalidateQueries({ queryKey: getOutletsListQueryKey() })
    toast({ title: `${outlet.name} updated`, description: 'Orders and the driver’s notes follow the new details.', tone: 'success' })
    onOpenChange(false)
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Edit ${outlet.name}`}
          description={`${outlet.id} · ${outlet.districtId} · depot ${outlet.depotId}`}
        />
        <form noValidate onSubmit={(e) => void onSubmit(e)}>
          <DialogBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Window opens" hint={MINUTE_HINT} error={errors.windowOpen?.message}>
                {(control) => <Input {...control} {...form.register('windowOpen')} disabled={!edit} className="font-mono" placeholder="06:00" />}
              </Field>
              <Field label="Window closes" error={errors.windowClose?.message}>
                {(control) => <Input {...control} {...form.register('windowClose')} disabled={!edit} className="font-mono" placeholder="10:00" />}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mall window opens" hint="Mall bays only; leave both empty otherwise." error={errors.mallWindowOpen?.message}>
                {(control) => <Input {...control} {...form.register('mallWindowOpen')} disabled={!edit} className="font-mono" placeholder="—" />}
              </Field>
              <Field label="Mall window closes" error={errors.mallWindowClose?.message}>
                {(control) => <Input {...control} {...form.register('mallWindowClose')} disabled={!edit} className="font-mono" placeholder="—" />}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Dock" error={errors.dockType?.message}>
                {(control) => (
                  <Controller
                    control={form.control}
                    name="dockType"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!edit}>
                        <SelectTrigger {...control}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(DOCK_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
              <Field label="Parking" error={errors.parkingConstraint?.message}>
                {(control) => (
                  <Controller
                    control={form.control}
                    name="parkingConstraint"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!edit}>
                        <SelectTrigger {...control}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PARKING_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Receiving contact" error={errors.receivingContactName?.message}>
                {(control) => <Input {...control} {...form.register('receivingContactName')} disabled={!edit} placeholder="Who signs for the delivery" />}
              </Field>
              <Field label="Contact phone" error={errors.receivingContactPhone?.message}>
                {(control) => <Input {...control} {...form.register('receivingContactPhone')} disabled={!edit} placeholder="+94 7…" />}
              </Field>
            </div>
            <Field label="Access notes" hint="The driver reads this at the dock (D9)." error={errors.accessNotes?.message}>
              {(control) => <Textarea {...control} {...form.register('accessNotes')} disabled={!edit} rows={3} placeholder="Use the lane behind the bakery." />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {edit ? (
              <Button type="submit" variant="primary" loading={isSubmitting}>
                Save outlet
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
