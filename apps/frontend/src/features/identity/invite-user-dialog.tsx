// Figma: A2 Invite user · 185:9045
import {
  getInvitationsListQueryKey,
  isApiProblem,
  useInvitationsCreate,
  useUsersScopeOptions,
  type CreateInvitationDto,
  type UserRole,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { applyProblem } from '@/lib/apply-problem'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { RadioCards } from '@/ui/radio-cards'
import { SegmentedControl } from '@/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { toast } from '@/ui/toast-store'
import { channelOf, EMAIL, toPhone } from './contact'
import { INVITABLE_ROLES, scopeChoices } from './scope-choices'

type InvitableRole = (typeof INVITABLE_ROLES)[number]['value']

interface InviteForm {
  name: string
  contact: string
  role: InvitableRole
  linkTo: string
}

/** Errors on these API fields show on the form field that holds them. */
const FIELD_OF: Record<string, keyof InviteForm> = {
  name: 'name',
  email: 'contact',
  phoneNumber: 'contact',
  role: 'role',
  depotId: 'linkTo',
  outletId: 'linkTo',
  vehicleId: 'linkTo',
}

export interface InviteUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Invite a store manager, dispatcher, loader or driver. The "Link to" options follow the role,
 * and the link goes out by email, or by SMS to a phone number.
 */
export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const queryClient = useQueryClient()
  const options = useUsersScopeOptions({ query: { enabled: open } })
  const create = useInvitationsCreate()
  const form = useForm<InviteForm>({ defaultValues: { name: '', contact: '', role: 'store_manager', linkTo: '' } })
  const { errors, isSubmitting } = form.formState
  const role = useWatch({ control: form.control, name: 'role' })
  const contact = useWatch({ control: form.control, name: 'contact' })
  const choices = scopeChoices(role, options.data?.data)

  const close = () => {
    form.reset()
    onOpenChange(false)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const choice = choices.find((c) => c.value === values.linkTo)
    const contactValue = values.contact.trim()
    const body: CreateInvitationDto = {
      name: values.name.trim(),
      role: values.role,
      ...(channelOf(contactValue) === 'email' ? { email: contactValue } : { phoneNumber: toPhone(contactValue) }),
      ...(choice?.depotId ? { depotId: choice.depotId } : {}),
      ...(choice?.outletId ? { outletId: choice.outletId } : {}),
      ...(choice?.vehicleId ? { vehicleId: choice.vehicleId } : {}),
    }
    try {
      await create.mutateAsync({ data: body, headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() } })
    } catch (error) {
      if (!isApiProblem(error)) throw error
      applyProblem(form, { ...error, errors: error.errors.map((e) => ({ ...e, field: FIELD_OF[e.field] ?? e.field })) }, { fields: Object.values(FIELD_OF) })
      return
    }
    await queryClient.invalidateQueries({ queryKey: getInvitationsListQueryKey() })
    toast({
      title: `Invite sent to ${body.name}`,
      description: body.email ? `An email went to ${body.email}.` : `An SMS went to ${contactValue}.`,
      tone: 'success',
    })
    close()
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title="Invite user" description="They get a link to set a password. Access is limited to what you link them to." />
        <form noValidate onSubmit={(e) => void onSubmit(e)}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Full name" error={errors.name?.message}>
              {(control) => <Input {...control} {...form.register('name', { required: 'Enter their full name' })} autoFocus />}
            </Field>
            <Field label="Email or phone" error={errors.contact?.message}>
              {(control) => (
                <Input
                  {...control}
                  placeholder="+94 77 … or name@waypoint.lk"
                  {...form.register('contact', {
                    required: 'Enter an email, or a phone number in +94 format',
                    validate: (v) =>
                      EMAIL.test(v.trim()) || /^\+94\d{9}$/.test(toPhone(v)) || 'Enter an email, or a phone number in +94 format',
                  })}
                />
              )}
            </Field>
            <Field label="Role" error={errors.role?.message}>
              {() => (
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <RadioCards
                      aria-label="Role"
                      value={field.value}
                      onValueChange={(next: InvitableRole) => {
                        field.onChange(next)
                        form.setValue('linkTo', '')
                      }}
                      options={INVITABLE_ROLES}
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
                  rules={{ validate: (v) => (role === 'dispatcher' ? true : v !== '' || 'Choose what they are linked to') }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={options.isPending}>
                      <SelectTrigger {...control}>
                        <SelectValue placeholder={options.isPending ? 'Loading…' : placeholderFor(role)} />
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
            <Field label="Send invite by">
              {() => (
                <SegmentedControl
                  aria-label="Send invite by"
                  className="self-start"
                  value={channelOf(contact)}
                  onValueChange={() => form.setFocus('contact')}
                  options={[
                    { value: 'email', label: 'Email' },
                    { value: 'sms', label: 'SMS' },
                  ]}
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
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function placeholderFor(role: UserRole): string {
  if (role === 'store_manager') return 'Choose an outlet'
  if (role === 'driver') return 'Choose a vehicle'
  return 'Choose a depot'
}
