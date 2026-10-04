// Figma: A1 Users · 185:8751 (the Edit action; no frame draws the dialog, so it follows A2)
import {
  getUsersListQueryKey,
  isApiProblem,
  useUsersDeactivate,
  useUsersReactivate,
  useUsersScopeOptions,
  useUsersSetPin,
  useUsersUpdate,
  type UpdateUserDto,
  type UserChangeReason,
  type UserDto,
  type UserRole,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { applyProblem } from '@/lib/apply-problem'
import { getLink } from '@/lib/links'
import { ROLE_LABELS } from '@/lib/roles'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { RadioCards } from '@/ui/radio-cards'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { toast } from '@/ui/toast-store'
import { currentChoice, scopeChoices } from './scope-choices'

const ROLES = (Object.keys(ROLE_LABELS) as UserRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }))

/** USER_CHANGE_REASONS (packages/shared), as A1 offers them. */
const REASONS: { value: UserChangeReason; label: string }[] = [
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'PROMOTION', label: 'Promotion' },
  { value: 'CORRECTION', label: 'Correction' },
  { value: 'OFFBOARDING', label: 'Leaving' },
  { value: 'OTHER', label: 'Other' },
]

/** What sits under the Dock PIN field: the PIN itself in demo mode, otherwise only whether one is set. */
function pinHint(hasPin: boolean, currentPin: string | null) {
  if (currentPin) return `Current PIN: ${currentPin}. A new one replaces it.`
  return hasPin ? 'A PIN is set. A new one replaces it.' : 'No PIN yet: they cannot sign in at the dock.'
}

interface EditForm {
  role: UserRole
  linkTo: string
  reasonCode: UserChangeReason | ''
  reasonNote: string
}

export interface EditUserDialogProps {
  user: UserDto
  onOpenChange: (open: boolean) => void
}

/**
 * Change a user's role or scope (with a reason; they are signed out everywhere), deactivate or
 * reactivate them, and set a loader's dock PIN. Each part shows only when the user carries the
 * matching link.
 */
export function EditUserDialog({ user, onOpenChange }: EditUserDialogProps) {
  const queryClient = useQueryClient()
  const options = useUsersScopeOptions()
  const update = useUsersUpdate()
  const deactivate = useUsersDeactivate()
  const reactivate = useUsersReactivate()
  const setPin = useUsersSetPin()
  const [pin, setPinValue] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  // Demo mode only: the server sends the PIN itself, so the admin can read it out to the loader.
  const [currentPin, setCurrentPin] = useState(user.demoPin)
  const [statusError, setStatusError] = useState<string | null>(null)
  const form = useForm<EditForm>({
    defaultValues: {
      role: user.role,
      linkTo: currentChoice(user.role, user) ?? '',
      reasonCode: '',
      reasonNote: '',
    },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  const role = useWatch({ control: form.control, name: 'role' })
  const choices = scopeChoices(role, options.data?.data)
  const refresh = () => queryClient.invalidateQueries({ queryKey: getUsersListQueryKey() })
  const edit = getLink(user._links, 'edit')

  const onSubmit = form.handleSubmit(async (values) => {
    const choice = choices.find((c) => c.value === values.linkTo)
    const body: UpdateUserDto = {
      role: values.role,
      depotId: choice?.depotId ?? null,
      outletId: choice?.outletId ?? null,
      vehicleId: choice?.vehicleId ?? null,
      ...(values.reasonCode ? { reasonCode: values.reasonCode } : {}),
      ...(values.reasonNote.trim() ? { reasonNote: values.reasonNote.trim() } : {}),
    }
    try {
      await update.mutateAsync({ id: user.id, data: body })
    } catch (error) {
      if (!isApiProblem(error)) throw error
      const fieldOf: Record<string, string> = { depotId: 'linkTo', outletId: 'linkTo', vehicleId: 'linkTo' }
      applyProblem(form, { ...error, errors: error.errors.map((e) => ({ ...e, field: fieldOf[e.field] ?? e.field })) }, {
        fields: ['role', 'linkTo', 'reasonCode', 'reasonNote'],
      })
      return
    }
    await refresh()
    toast({ title: `${user.name} updated`, description: 'They are signed out everywhere and see the change when they sign in.', tone: 'success' })
    onOpenChange(false)
  })

  const changeStatus = async (run: () => Promise<unknown>, done: string) => {
    setStatusError(null)
    try {
      await run()
    } catch (error) {
      setStatusError(isApiProblem(error) ? (error.detail ?? error.title) : 'That did not work. Try again.')
      throw error
    }
    await refresh()
    toast({ title: done, tone: 'success' })
    onOpenChange(false)
  }

  const savePin = async () => {
    setPinError(null)
    if (!/^\d{4}$/.test(pin)) {
      setPinError('The PIN is 4 digits')
      return
    }
    try {
      const saved = await setPin.mutateAsync({ id: user.id, data: { pin } })
      setCurrentPin(saved.data.demoPin)
    } catch (error) {
      setPinError(isApiProblem(error) ? (error.errors[0]?.message ?? error.detail ?? error.title) : 'That did not work. Try again.')
      return
    }
    setPinValue('')
    await refresh()
    toast({ title: `PIN set for ${user.name}`, tone: 'success' })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={`Edit ${user.name}`} description="A role or scope change needs a reason and signs them out on every device." />
        <form noValidate className="flex min-h-0 flex-col" onSubmit={(e) => void onSubmit(e)}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Role" error={errors.role?.message}>
              {() => (
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <RadioCards
                      aria-label="Role"
                      value={field.value}
                      onValueChange={(next: UserRole) => {
                        field.onChange(next)
                        form.setValue('linkTo', currentChoice(next, user) ?? '', { shouldDirty: true })
                      }}
                      options={ROLES}
                    />
                  )}
                />
              )}
            </Field>
            <Field label="Link to" hint="Scopes what this person can see." error={errors.linkTo?.message}>
              {(control) => (
                <Controller
                  control={form.control}
                  name="linkTo"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!edit || options.isPending}>
                      <SelectTrigger {...control}>
                        <SelectValue placeholder={options.isPending ? 'Loading…' : 'Choose'} />
                      </SelectTrigger>
                      <SelectContent>
                        {choices.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reason" error={errors.reasonCode?.message}>
                {(control) => (
                  <Controller
                    control={form.control}
                    name="reasonCode"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!edit}>
                        <SelectTrigger {...control}>
                          <SelectValue placeholder="Choose a reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {REASONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
              <Field label="Note" error={errors.reasonNote?.message}>
                {(control) => <Input {...control} {...form.register('reasonNote')} placeholder="Optional" disabled={!edit} />}
              </Field>
            </div>
            {getLink(user._links, 'setPin') ? (
              <Field label="Dock PIN" hint={pinHint(user.hasPin, currentPin)} error={pinError ?? undefined}>
                {(control) => (
                  <div className="flex gap-2">
                    <Input
                      {...control}
                      inputMode="numeric"
                      maxLength={4}
                      autoComplete="off"
                      value={pin}
                      onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                      placeholder="4 digits"
                      className="w-32 font-mono"
                    />
                    <Button type="button" variant="outline" loading={setPin.isPending} onClick={() => void savePin()}>
                      {getLink(user._links, 'setPin')?.title ?? 'Set PIN'}
                    </Button>
                  </div>
                )}
              </Field>
            ) : null}
            {statusError || errors.root?.server ? (
              <p role="alert" className="type-body m-0 text-destructive-foreground">
                {statusError ?? errors.root?.server?.message}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="justify-between">
            <div className="flex gap-2">
              <Action
                variant="destructive"
                link={user._links.deactivate}
                confirm={{
                  title: `Deactivate ${user.name}?`,
                  description: 'They are signed out and cannot sign in. Their history stays.',
                  confirmLabel: 'Deactivate',
                }}
                onAction={() => changeStatus(() => deactivate.mutateAsync({ id: user.id }), `${user.name} deactivated`)}
              />
              <Action
                variant="outline"
                link={user._links.reactivate}
                onAction={() => changeStatus(() => reactivate.mutateAsync({ id: user.id }), `${user.name} reactivated`)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {edit ? (
                <Button type="submit" variant="primary" loading={isSubmitting} disabled={!isDirty}>
                  Save changes
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
