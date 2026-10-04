// Figma: A6 Settings · 185:10227 (Security; drawn like "List item / Reasons": chips and Add)
import {
  getSettingsGetQueryKey,
  getSettingsGetQueryOptions,
  isApiProblem,
  useSettingsSet,
  useUsersScopeOptions,
  type SettingDto,
} from '@compass/api-client'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { SettingRow } from './setting-row'

const KEY = 'loading.dockLoaders'

const namesOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : [])

interface Depot {
  id: string
  name: string
}

/**
 * The loaders who share each depot's dock tablet, by name only: they need no accounts, and the
 * tablet's Checked by offers these names (AC-LOD-20). Drawn like the deferral reasons: a chip per
 * loader with its depot, × to take one off, and Add for a dialog with the depot and the name. Each
 * depot's list is its `loading.dockLoaders` setting; changing it needs the setting's edit link.
 */
export function DockLoadersSection() {
  const queryClient = useQueryClient()
  const depots = useUsersScopeOptions().data?.data.depots ?? []
  const lists = useQueries({
    queries: depots.map((d) => getSettingsGetQueryOptions(KEY, { depotId: d.id })),
  })
  const save = useSettingsSet()
  const [adding, setAdding] = useState(false)

  const settingOf = (depotId: string): SettingDto | undefined => lists[depots.findIndex((d) => d.id === depotId)]?.data?.data
  const write = async (depotId: string, names: string[]) => {
    await save.mutateAsync({ key: KEY, params: { depotId }, data: { value: names as unknown as Record<string, unknown> } })
    await queryClient.invalidateQueries({ queryKey: getSettingsGetQueryKey(KEY, { depotId }) })
  }

  const remove = async (depot: Depot, name: string) => {
    try {
      await write(
        depot.id,
        namesOf(settingOf(depot.id)?.value).filter((n) => n !== name),
      )
      toast({ title: `${name} removed from ${depot.name}` })
    } catch (error) {
      toast({ title: 'Not removed', description: isApiProblem(error) ? (error.detail ?? error.title) : 'Try again.', tone: 'danger' })
    }
  }

  const loading = depots.length === 0 || lists.some((q) => q.isPending)
  const failed = lists.some((q) => q.isError)
  const editable = depots.filter((d) => getLink(settingOf(d.id)?._links, 'edit'))

  return (
    <SettingRow title="Loaders" description="Names only, no accounts needed. Shown on the dock tablet’s Checked by.">
      {loading ? (
        <Skeleton className="h-[50px] w-[260px]" />
      ) : failed ? (
        <p className="type-caption m-0 text-destructive-foreground">Dock loaders did not load.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {depots.flatMap((depot) => {
            const setting = settingOf(depot.id)
            const canEdit = Boolean(getLink(setting?._links, 'edit'))
            return namesOf(setting?.value).map((name) => (
              <span key={`${depot.id}:${name}`} className="inline-flex items-center gap-1">
                <StatusChip tone="neutral">{`${name} · ${depot.name}`}</StatusChip>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove ${name} from ${depot.name}`}
                    disabled={save.isPending}
                    onClick={() => void remove(depot, name)}
                    className="cursor-pointer rounded-sm border-0 bg-transparent px-1 font-sans text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))
          })}
          {editable.length ? (
            <Button variant="link" size="sm" className="h-[22px] px-1.5" onClick={() => setAdding(true)}>
              Add
            </Button>
          ) : null}
          <AddLoaderDialog
            open={adding}
            onOpenChange={setAdding}
            depots={editable}
            namesAt={(depotId) => namesOf(settingOf(depotId)?.value)}
            onAdd={async (depot, name) => {
              await write(depot.id, [...namesOf(settingOf(depot.id)?.value), name])
              toast({ title: `${name} added to ${depot.name}`, tone: 'success' })
            }}
          />
        </div>
      )}
    </SettingRow>
  )
}

interface LoaderForm {
  depotId: string
  name: string
}

interface AddLoaderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  depots: Depot[]
  namesAt: (depotId: string) => string[]
  onAdd: (depot: Depot, name: string) => Promise<void>
}

function AddLoaderDialog({ open, onOpenChange, depots, namesAt, onAdd }: AddLoaderDialogProps) {
  const form = useForm<LoaderForm>({ defaultValues: { depotId: '', name: '' } })
  const { errors, isSubmitting } = form.formState

  const close = () => {
    form.reset()
    onOpenChange(false)
  }
  const onSubmit = form.handleSubmit(async ({ depotId, name }) => {
    const depot = depots.find((d) => d.id === depotId)
    const typed = name.trim()
    if (!depot) return
    if (namesAt(depot.id).some((n) => n.toLowerCase() === typed.toLowerCase())) {
      form.setError('name', { message: `${typed} is already on ${depot.name}’s list` })
      return
    }
    try {
      await onAdd(depot, typed)
    } catch (error) {
      form.setError('root.server', { message: isApiProblem(error) ? (error.errors[0]?.message ?? error.detail ?? error.title) : 'Not added. Try again.' })
      return
    }
    close()
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title="Add a dock loader" description="Loaders at this depot pick their name from the list when they check items on the dock tablet." />
        <form noValidate className="flex min-h-0 flex-col" onSubmit={(e) => void onSubmit(e)}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Depot" error={errors.depotId?.message}>
              {(control) => (
                <Controller
                  control={form.control}
                  name="depotId"
                  rules={{ required: 'Pick the depot' }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={control.id} aria-describedby={control['aria-describedby']} aria-invalid={control['aria-invalid']}>
                        <SelectValue placeholder="Pick a depot" />
                      </SelectTrigger>
                      <SelectContent>
                        {depots.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
            <Field label="Name" error={errors.name?.message}>
              {(control) => (
                <Input
                  {...control}
                  placeholder="Kasun Perera"
                  maxLength={60}
                  {...form.register('name', { required: 'Enter the loader’s name', validate: (v) => v.trim() !== '' || 'Enter the loader’s name' })}
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
              Add loader
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
