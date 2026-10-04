// Figma: A4 Depots · 185:9769 (the Run waves panel)
import {
  getDepotWavesListQueryKey,
  isApiProblem,
  useDepotWavesCreate,
  useDepotWavesList,
  useDepotWavesRemove,
  useDepotWavesUpdate,
  type Brand,
  type DepotDto,
  type DepotWaveDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Field } from '@/ui/field'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'
import { MINUTE_HINT, minuteLabel, parseMinute } from './minutes'

const ALL_BRANDS: readonly Brand[] = ['FRESH', 'STYLE', 'TECH']

interface WaveDraft {
  label: string
  from: string
  to: string
  brands: Brand[]
}

const emptyDraft = (): WaveDraft => ({ label: '', from: '', to: '', brands: ['FRESH'] })

/**
 * A depot's departure bands: "Run 1" 05:15–06:30 and "Run 2" 11:00–12:30, as
 * the seed sets them. One label per depot, so adding a second "Run 1" is
 * refused; a wave trips are already planned in cannot be removed (AC-MD-07).
 * The panel shows only for a caller who may read waves (`masterData:manage`).
 */
export function DepotWavesCard({ depot }: { depot: DepotDto }) {
  const queryClient = useQueryClient()
  const canManage = Boolean(depot._links.edit)
  const waves = useDepotWavesList(depot.id, { query: { enabled: canManage } })
  const create = useDepotWavesCreate()
  const update = useDepotWavesUpdate()
  const remove = useDepotWavesRemove()
  const [draft, setDraft] = useState<WaveDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!canManage) return null

  const rows = waves.data?.data ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: getDepotWavesListQueryKey(depot.id) })

  const submit = async () => {
    if (!draft) return
    const from = parseMinute(draft.from)
    const to = parseMinute(draft.to)
    if (draft.label.trim() === '') return setError('Give the wave a name, such as "Run 1".')
    if (from === null || to === null) return setError(`Use ${MINUTE_HINT} for both ends of the band.`)
    if (draft.brands.length === 0) return setError('Pick at least one brand.')
    setError(null)
    try {
      await create.mutateAsync({
        depotId: depot.id,
        data: { label: draft.label.trim(), departFromMin: from, departToMin: to, brands: draft.brands },
      })
    } catch (problem) {
      setError(isApiProblem(problem) ? (problem.errors[0]?.message ?? problem.detail ?? problem.title) : 'That did not work. Try again.')
      return
    }
    await refresh()
    toast({ title: `${draft.label.trim()} added`, tone: 'success' })
    setDraft(null)
  }

  return (
    <section aria-labelledby={`${depot.id}-waves`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id={`${depot.id}-waves`} className="m-0 font-sans text-[15px] font-bold leading-[21px] text-foreground">
          Run waves
        </h4>
        {draft ? null : (
          <Button variant="outline" size="sm" onClick={() => setDraft(emptyDraft())}>
            Add a wave
          </Button>
        )}
      </div>

      {waves.error ? (
        <ErrorState error={waves.error} onRetry={() => void waves.refetch()} />
      ) : waves.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : rows.length === 0 && !draft ? (
        <EmptyState title="No waves yet" description="Add Run 1 and Run 2 so trips have a departure band." />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-[22%]">Wave</TableHead>
                <TableHead className="w-[24%]">Departs between</TableHead>
                <TableHead>Brands</TableHead>
                <TableHead className="w-[150px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((wave) => (
                <WaveRow
                  key={wave.id}
                  depotId={depot.id}
                  wave={wave}
                  onSave={async (values) => {
                    await update.mutateAsync({ depotId: depot.id, id: wave.id, data: values })
                    await refresh()
                    toast({ title: `${wave.label} saved`, tone: 'success' })
                  }}
                  onRemove={async () => {
                    await remove.mutateAsync({ depotId: depot.id, id: wave.id })
                    await refresh()
                    toast({ title: `${wave.label} removed` })
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {draft ? (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-secondary/40 p-3">
          <Field label="Wave" className="w-[140px]">
            {(control) => (
              <Input {...control} value={draft.label} placeholder="Run 1" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            )}
          </Field>
          <Field label="From" className="w-[120px]">
            {(control) => (
              <Input {...control} className="font-mono" value={draft.from} placeholder="05:15" onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            )}
          </Field>
          <Field label="To" className="w-[120px]">
            {(control) => (
              <Input {...control} className="font-mono" value={draft.to} placeholder="06:30" onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            )}
          </Field>
          <Field label="Brands" className="flex-1 min-w-[220px]">
            {() => <BrandPicker value={draft.brands} onChange={(brands) => setDraft({ ...draft, brands })} />}
          </Field>
          <div className="mt-[26px] flex gap-2">
            <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
              Add wave
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? (
            <p role="alert" className="type-caption m-0 w-full text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

interface WaveRowProps {
  depotId: string
  wave: DepotWaveDto
  onSave: (values: { departFromMin: number; departToMin: number; brands: Brand[] }) => Promise<void>
  onRemove: () => Promise<void>
}

/** One wave: its band and brands, editable in place. */
function WaveRow({ wave, onSave, onRemove }: WaveRowProps) {
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState(minuteLabel(wave.departFromMin))
  const [to, setTo] = useState(minuteLabel(wave.departToMin))
  const [brands, setBrands] = useState<Brand[]>(wave.brands)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const fromMin = parseMinute(from)
    const toMin = parseMinute(to)
    if (fromMin === null || toMin === null) return setError(`Use ${MINUTE_HINT}.`)
    if (brands.length === 0) return setError('Pick at least one brand.')
    setError(null)
    try {
      await onSave({ departFromMin: fromMin, departToMin: toMin, brands })
    } catch (problem) {
      setError(isApiProblem(problem) ? (problem.errors[0]?.message ?? problem.detail ?? problem.title) : 'That did not work. Try again.')
      return
    }
    setEditing(false)
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{wave.label}</TableCell>
      <TableCell>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input size="sm" className="w-[88px] font-mono" aria-label="Departs from" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-muted-foreground">–</span>
            <Input size="sm" className="w-[88px] font-mono" aria-label="Departs to" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        ) : (
          <span className="type-data">
            {wave.departFrom}–{wave.departTo}
          </span>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <BrandPicker value={brands} onChange={setBrands} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {wave.brands.map((brand) => (
              <StatusChip key={brand} tone="info">
                {brand}
              </StatusChip>
            ))}
          </div>
        )}
        {error ? (
          <p role="alert" className="type-caption m-0 pt-1 text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        {editing ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="primary" onClick={() => void save()}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setError(null)
                setFrom(minuteLabel(wave.departFromMin))
                setTo(minuteLabel(wave.departToMin))
                setBrands(wave.brands)
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Action variant="ghost" size="sm" className="text-slate-700" link={getLink(wave._links, 'edit')} onAction={() => setEditing(true)}>
              Edit
            </Action>
            <Action
              variant="ghost"
              size="sm"
              className="text-destructive-foreground"
              link={getLink(wave._links, 'remove')}
              confirm={{
                title: `Remove ${wave.label}?`,
                description: 'Trips already planned in this wave keep it; the wave goes only when none are left.',
                confirmLabel: 'Remove',
              }}
              onAction={onRemove}
            >
              Remove
            </Action>
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

/** The brands a wave carries, as toggles. */
function BrandPicker({ value, onChange }: { value: Brand[]; onChange: (brands: Brand[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_BRANDS.map((brand) => {
        const on = value.includes(brand)
        return (
          <Button
            key={brand}
            type="button"
            size="sm"
            variant={on ? 'primary' : 'outline'}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((b) => b !== brand) : [...value, brand])}
          >
            {brand}
          </Button>
        )
      })}
    </div>
  )
}
