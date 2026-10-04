// Figma: A6 Settings · 185:10227 ("List item / Reasons": the reason chips and Add)
import {
  getDeferralReasonsListQueryKey,
  isApiProblem,
  useDeferralReasonsCreate,
  useDeferralReasonsList,
  useDeferralReasonsUpdate,
  type DeferralReasonDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { applyProblem } from '@/lib/apply-problem'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'

/** "NO_REEFER_CAPACITY" reads as "NO REEFER CAPACITY" on the chip. */
const chipText = (code: string) => code.replace(/_/g, ' ')

/**
 * The deferral reasons as chips. The engine's own reasons always stay; a reason added here can be
 * turned off and on again. Add needs settings:manage (the list's create link).
 */
export function DeferralReasonsField() {
  const queryClient = useQueryClient()
  const reasons = useDeferralReasonsList()
  const update = useDeferralReasonsUpdate()
  const [adding, setAdding] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: getDeferralReasonsListQueryKey() })

  if (reasons.isPending) return <Skeleton className="h-[50px] w-[260px]" />
  if (reasons.error) return <p className="type-caption m-0 text-destructive-foreground">Reasons did not load.</p>

  const toggle = async (reason: DeferralReasonDto, active: boolean) => {
    await update.mutateAsync({ code: reason.code, data: { active } })
    await refresh()
    toast({ title: `${reason.label} turned ${active ? 'on' : 'off'}` })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {reasons.data.data.map((reason) => {
        const off = getLink(reason._links, 'deactivate')
        const on = getLink(reason._links, 'activate')
        return (
          <span key={reason.code} title={reason.label} className="inline-flex items-center gap-1">
            <StatusChip tone={reason.active ? 'neutral' : 'muted'} className={reason.active ? undefined : 'line-through'}>
              {chipText(reason.code)}
            </StatusChip>
            {off || on ? (
              <button
                type="button"
                aria-label={off ? `Turn off ${reason.label}` : `Turn on ${reason.label}`}
                onClick={() => void toggle(reason, !off)}
                className="cursor-pointer rounded-sm border-0 bg-transparent px-1 font-sans text-[12px] text-muted-foreground hover:text-foreground"
              >
                {off ? '×' : '↺'}
              </button>
            ) : null}
          </span>
        )
      })}
      {getLink(reasons.data._links, 'create') ? (
        <Button variant="link" size="sm" className="h-[22px] px-1.5" onClick={() => setAdding(true)}>
          Add
        </Button>
      ) : null}
      <AddReasonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={async (label) => {
          await refresh()
          toast({ title: `${label} added`, tone: 'success' })
        }}
      />
    </div>
  )
}

interface ReasonForm {
  label: string
  code: string
}

function AddReasonDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: (label: string) => Promise<void> }) {
  const create = useDeferralReasonsCreate()
  const form = useForm<ReasonForm>({ defaultValues: { label: '', code: '' } })
  const { errors, isSubmitting } = form.formState

  const close = () => {
    form.reset()
    onOpenChange(false)
  }
  const onSubmit = form.handleSubmit(async ({ label, code }) => {
    try {
      await create.mutateAsync({ data: { label: label.trim(), code: code.trim() } })
    } catch (error) {
      if (isApiProblem(error)) applyProblem(form, error, { fields: ['label', 'code'] })
      else throw error
      return
    }
    await onAdded(label.trim())
    close()
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title="Add a deferral reason" description="Dispatchers can pick it when they defer an order, and the store sees its label." />
        <form noValidate className="flex min-h-0 flex-col" onSubmit={(e) => void onSubmit(e)}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Label" error={errors.label?.message}>
              {(control) => (
                <Input
                  {...control}
                  autoFocus
                  placeholder="Store closed for a holiday"
                  {...form.register('label', {
                    required: 'Enter the label the store sees',
                    onChange: (e: { target: { value: string } }) => {
                      if (!form.getFieldState('code').isDirty)
                        form.setValue('code', e.target.value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''))
                    },
                  })}
                />
              )}
            </Field>
            <Field label="Code" hint="Capital letters, digits and _ only." error={errors.code?.message}>
              {(control) => (
                <Input
                  {...control}
                  className="font-mono"
                  {...form.register('code', {
                    required: 'Enter a code',
                    pattern: { value: /^[A-Z][A-Z0-9_]{1,59}$/, message: 'Capital letters, digits and _ only, like STORE_CLOSED' },
                  })}
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
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Add reason
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
