// Figma: M1 New order · 185:10376 ("Button / Save as preset"); the naming step has no frame of
// its own, so it uses the Compass dialog (docs/departures.md).
import { isApiProblem, useOrdersSaveAsTemplate, type OrderDto } from '@compass/api-client'
import { useForm } from 'react-hook-form'
import { applyProblem } from '@/lib/apply-problem'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { toast } from '@/ui/toast-store'
import { classLabelInline } from './order-format'

interface PresetForm {
  name: string
}

export interface SavePresetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: OrderDto
  /** Refreshes the preset list once the new one exists. */
  onSaved: () => Promise<unknown>
}

/** Keeps this order's lines as a preset the store can load into a later order. */
export function SavePresetDialog({ open, onOpenChange, order, onSaved }: SavePresetDialogProps) {
  const save = useOrdersSaveAsTemplate()
  const form = useForm<PresetForm>({ defaultValues: { name: '' } })
  const { errors, isSubmitting } = form.formState

  const close = () => {
    form.reset()
    onOpenChange(false)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const name = values.name.trim()
    try {
      await save.mutateAsync({
        id: order.id,
        data: { name },
        headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
      })
    } catch (error) {
      if (!isApiProblem(error)) throw error
      applyProblem(form, error, { fields: ['name'] })
      return
    }
    await onSaved()
    toast({ title: `Preset “${name}” saved`, description: `Load it into any ${classLabelInline(order.tempClass)}.`, tone: 'success' })
    close()
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader
          title="Save as preset"
          description={`The ${order.totals.lines} items on this order, ready to load next time.`}
        />
        <form noValidate onSubmit={(e) => void onSubmit(e)}>
          <DialogBody>
            <Field label="Preset name" error={errors.name?.message}>
              {(control) => (
                <Input
                  {...control}
                  placeholder="Weekday top-up"
                  autoFocus
                  {...form.register('name', { required: 'Give the preset a name' })}
                />
              )}
            </Field>
            {errors.root?.server ? (
              <p role="alert" className="type-body m-0 text-destructive-foreground">
                {errors.root.server.message}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Save preset
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
