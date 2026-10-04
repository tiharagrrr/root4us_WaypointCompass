// Figma: A4 Depots · 185:9769
import {
  getDepotsListQueryKey,
  isApiProblem,
  useDepotsList,
  useDepotsUpdate,
  type DepotDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { toast } from '@/ui/toast-store'
import { DepotWavesCard } from './depot-waves-card'
import { MINUTE_HINT, minuteLabel, parseMinute } from './minutes'

/** The three numbers A4 edits per depot, as drafts so one Save sends them together. */
interface DepotDraft {
  dockCount: string
  chilledDocks: string
  cutoff: string
}

const draftOf = (depot: DepotDto): DepotDraft => ({
  dockCount: String(depot.dockCount),
  chilledDocks: String(depot.chilledDocks),
  cutoff: minuteLabel(depot.cutoffMin),
})

/**
 * Depots on A4: how many docks each has, how many of them are chilled, the
 * cutoff it may run on instead of the global one, and its run waves. The
 * cutoff field is the depot's own override; the line under it says which
 * cutoff is actually in force (AC-MD-06).
 */
export function DepotsPage() {
  const depots = useDepotsList()
  const rows = depots.data?.data ?? []

  return (
    <>
      <p className="type-body m-0 text-muted-foreground">
        Docks decide how many trips can load at once. A depot's cutoff overrides the global order deadline for every outlet it serves.
      </p>

      {depots.error ? (
        <ErrorState error={depots.error} onRetry={() => void depots.refetch()} />
      ) : depots.isPending ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-40" />
              </CardHeader>
              <CardContent className="flex gap-3">
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No depots yet" description="Depots arrive with the seed from the booklet's reference data." />
      ) : (
        <div className="flex flex-col gap-6">
          {rows.map((depot) => (
            <DepotCard key={depot.id} depot={depot} />
          ))}
        </div>
      )}
    </>
  )
}

function DepotCard({ depot }: { depot: DepotDto }) {
  const queryClient = useQueryClient()
  const save = useDepotsUpdate()
  const [draft, setDraft] = useState<DepotDraft>(draftOf(depot))
  const [errors, setErrors] = useState<Partial<Record<keyof DepotDraft, string>>>({})
  const editable = Boolean(depot._links.edit)
  const current = draftOf(depot)
  const changed = (Object.keys(draft) as (keyof DepotDraft)[]).some((key) => draft[key] !== current[key])

  const onSave = async () => {
    const next: Partial<Record<keyof DepotDraft, string>> = {}
    const dockCount = Number(draft.dockCount)
    const chilledDocks = Number(draft.chilledDocks)
    if (!Number.isInteger(dockCount) || dockCount < 0) next.dockCount = 'A whole number of docks.'
    if (!Number.isInteger(chilledDocks) || chilledDocks < 0) next.chilledDocks = 'A whole number of docks.'
    const cutoffMin = draft.cutoff.trim() === '' ? null : parseMinute(draft.cutoff)
    if (draft.cutoff.trim() !== '' && cutoffMin === null) next.cutoff = `Use ${MINUTE_HINT}.`
    setErrors(next)
    if (Object.keys(next).length > 0) return

    try {
      await save.mutateAsync({ id: depot.id, data: { dockCount, chilledDocks, cutoffMin } })
    } catch (error) {
      if (!isApiProblem(error)) throw error
      const byField: Partial<Record<keyof DepotDraft, string>> = {}
      for (const problem of error.errors) {
        if (problem.field === 'dockCount') byField.dockCount = problem.message
        else if (problem.field === 'chilledDocks') byField.chilledDocks = problem.message
        else if (problem.field === 'cutoffMin') byField.cutoff = problem.message
      }
      setErrors(Object.keys(byField).length > 0 ? byField : { dockCount: error.detail ?? error.title })
      return
    }
    await queryClient.invalidateQueries({ queryKey: getDepotsListQueryKey() })
    toast({ title: `${depot.name} saved`, description: 'Planning and the cutoff job pick it up at once.', tone: 'success' })
  }

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle>
          {depot.name} <span className="type-body font-normal text-muted-foreground">· {depot.id}</span>
        </CardTitle>
        <p className="type-body m-0 text-muted-foreground">
          Cutoff in force: <span className="type-data text-foreground">{depot.effectiveCutoff}</span>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-4">
          <Field label="Docks" error={errors.dockCount} className="w-[140px]">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={draft.dockCount}
                disabled={!editable}
                onChange={(e) => setDraft((d) => ({ ...d, dockCount: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Chilled docks" hint="No more than the docks." error={errors.chilledDocks} className="w-[160px]">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={draft.chilledDocks}
                disabled={!editable}
                onChange={(e) => setDraft((d) => ({ ...d, chilledDocks: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Cutoff override" hint="Empty follows the global cutoff." error={errors.cutoff} className="w-[180px]">
            {(control) => (
              <Input
                {...control}
                className="font-mono"
                placeholder="—"
                value={draft.cutoff}
                disabled={!editable}
                onChange={(e) => setDraft((d) => ({ ...d, cutoff: e.target.value }))}
              />
            )}
          </Field>
          {editable ? (
            <Button variant="primary" className="mt-[26px]" loading={save.isPending} disabled={!changed} onClick={() => void onSave()}>
              Save depot
            </Button>
          ) : null}
        </div>

        <DepotWavesCard depot={depot} />
      </CardContent>
    </Card>
  )
}
