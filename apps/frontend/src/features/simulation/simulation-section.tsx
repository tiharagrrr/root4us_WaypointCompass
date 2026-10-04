// Figma: A6 Settings · 185:10227 (Demo; the run controls are in specs/simulation/spec.md, not drawn in the frame)
import {
  getClockGetQueryKey,
  getSettingsListQueryKey,
  getSimulationsListQueryKey,
  isApiProblem,
  useDepotsList,
  usePlansForDay,
  useSettingsSet,
  useSimulationsCreate,
  useSimulationsList,
  useSimulationsPause,
  useSimulationsResume,
  useSimulationsStart,
  useSimulationsStop,
  type ClockDto,
  type SimulationDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { SettingRow } from '@/features/identity/setting-row'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Badge } from '@/ui/badge'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Switch } from '@/ui/switch'
import { toast } from '@/ui/toast-store'

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Ready to start',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  COMPLETED: 'Finished',
  FAILED: 'Failed',
}

const KIND_TEXT: Record<string, string> = {
  ROAD_DELAY: 'Road delay',
  FAILED_DELIVERY: 'Failed delivery',
}

const count = (kpis: SimulationDto['kpis'], key: string) => {
  const value = kpis?.[key]
  return typeof value === 'number' ? value : 0
}

const messageOf = (e: unknown, fallback: string) => (isApiProblem(e) ? (e.errors[0]?.message ?? e.detail ?? e.title) : fallback)

/**
 * The simulator on A6's Demo section: a run on a published plan, with the virtual drivers playing
 * the day at 60x. The AI scenario director is behind its own switch: the option to let it add
 * trouble, its AI badges and its report show only while the collection carries the `director`
 * link, which the server offers when a model is configured and the switch is on. Renders nothing
 * when the simulator is off (the API answers 404).
 */
export function SimulationSection({ clock }: { clock: ClockDto }) {
  const queryClient = useQueryClient()
  const runs = useSimulationsList({ query: { refetchInterval: 2_000, retry: false } })
  const depots = useDepotsList()
  const setSetting = useSettingsSet()
  const create = useSimulationsCreate()
  const start = useSimulationsStart()
  const pause = useSimulationsPause()
  const resume = useSimulationsResume()
  const stop = useSimulationsStop()

  const [depotId, setDepotId] = useState('')
  const [date, setDate] = useState(toColomboDate(clock.now))
  const [agentic, setAgentic] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const depot = depotId || depots.data?.data[0]?.id || ''
  const plan = usePlansForDay(depot, date, { query: { enabled: depot !== '' && date !== '', retry: false } })

  if (!runs.data) return null

  const links = runs.data._links
  const director = getLink(links, 'director')
  const toggle = getLink(links, 'enableDirector') ?? getLink(links, 'disableDirector')
  const directorOn = Boolean(director)
  const run = runs.data.data[0]
  const live = run && ['DRAFT', 'RUNNING', 'PAUSED'].includes(run.status) ? run : undefined
  const published = plan.data?.data.status === 'PUBLISHED' ? plan.data.data : undefined

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getSimulationsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getClockGetQueryKey() }),
    ])

  const act = async (work: () => Promise<unknown>, done: string) => {
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(messageOf(e, 'The simulation did not change.'))
      return
    }
    await refresh()
    toast({ title: done, tone: 'success' })
  }

  const setDirector = async (on: boolean) => {
    setError(null)
    try {
      await setSetting.mutateAsync({ key: 'simulation.aiDirector', data: { value: on } })
    } catch (e) {
      setError(messageOf(e, 'Not saved. Try again.'))
      return
    }
    if (!on) setAgentic(false)
    await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: getSettingsListQueryKey() })])
    toast({ title: on ? 'AI scenario director on' : 'AI scenario director off', tone: 'success' })
  }

  const begin = async () => {
    if (!published) return
    const created = await create.mutateAsync({ data: { scenario: 'normal-day', planId: published.id, seed: 42, agentic: directorOn && agentic } })
    await start.mutateAsync({ id: created.data.id })
  }

  return (
    <>
      <SettingRow
        title="AI scenario director"
        description={
          toggle || directorOn
            ? 'A model watches the run and may add trouble: a road delay or a failed delivery. It sees ids, vehicle codes and times only.'
            : 'Off: no model is configured on the server, or only an admin can turn this on.'
        }
      >
        <Switch
          aria-label="AI scenario director"
          checked={directorOn}
          disabled={!toggle || setSetting.isPending}
          onCheckedChange={(on) => void setDirector(on)}
        />
      </SettingRow>

      <SettingRow
        title="Simulation"
        description={
          live ? (
            <>
              {STATUS_TEXT[live.status]}
              {live.simNow ? ` · simulated time ${formatColombo(live.simNow, 'EEE d MMM HH:mm')}` : ''} · {count(live.kpis, 'stopsDelivered')} delivered,{' '}
              {count(live.kpis, 'stopsFailed')} failed
            </>
          ) : (
            'Virtual drivers play a published plan at 60 times real speed. Needs the worker running.'
          )
        }
        error={error ?? undefined}
      >
        {live ? (
          <div className="flex flex-wrap items-center gap-2">
            {directorOn && live.agentic ? <Badge tone="info">AI director</Badge> : null}
            <Action size="sm" link={live._links.start} onAction={() => act(() => start.mutateAsync({ id: live.id }), 'Simulation started')} />
            <Action size="sm" variant="outline" link={live._links.pause} onAction={() => act(() => pause.mutateAsync({ id: live.id }), 'Simulation paused')} />
            <Action size="sm" variant="outline" link={live._links.resume} onAction={() => act(() => resume.mutateAsync({ id: live.id }), 'Simulation resumed')} />
            <Action
              size="sm"
              variant="destructive"
              link={live._links.stop}
              confirm={{ title: 'Stop the simulation?', description: 'The demo clock stays where the run ended.', confirmLabel: 'Stop' }}
              onAction={() => act(() => stop.mutateAsync({ id: live.id }), 'Simulation stopped')}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Select value={depot} onValueChange={setDepotId} disabled={depots.isPending}>
                <SelectTrigger aria-label="Depot" className="w-[180px]">
                  <SelectValue placeholder={depots.isPending ? 'Loading…' : 'Depot'} />
                </SelectTrigger>
                <SelectContent>
                  {(depots.data?.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" aria-label="Plan date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[160px] font-mono" />
            </div>
            {director ? (
              <label className="type-body flex cursor-pointer items-center gap-2 text-foreground">
                <Checkbox aria-label={director.title} checked={agentic} onCheckedChange={(on) => setAgentic(on === true)} />
                {director.title}
              </label>
            ) : null}
            {published ? (
              <Action size="sm" className="self-start" link={getLink(links, 'create')} onAction={() => act(begin, 'Simulation started')}>
                Start simulation
              </Action>
            ) : (
              <p className="type-caption m-0 text-muted-foreground">{plan.isFetching ? 'Looking for the plan…' : 'No published plan for that depot and date.'}</p>
            )}
          </div>
        )}
      </SettingRow>

      {run && (run.injections.length > 0 || run.narrative) ? (
        <SettingRow title={live ? 'Trouble' : 'Last run'} description={live ? 'What has been added to this run.' : `${STATUS_TEXT[run.status] ?? run.status}.`}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {run.injections.map((injection) => (
              <li key={injection.id} className="type-body flex flex-wrap items-center gap-2 text-foreground">
                <span className="font-mono">{formatColombo(injection.atSim, 'HH:mm')}</span>
                {KIND_TEXT[injection.kind] ?? injection.kind}
                {directorOn && injection.proposedBy === 'agent' ? <Badge tone="info">AI</Badge> : null}
                <Badge tone={injection.firedAt ? 'success' : 'muted'}>{injection.firedAt ? 'Fired' : 'Waiting'}</Badge>
              </li>
            ))}
          </ul>
          {run.narrative ? (
            <p className="type-body m-0 text-muted-foreground">
              {directorOn && run.agentic ? <span className="font-bold text-foreground">Director’s report. </span> : null}
              {run.narrative}
            </p>
          ) : null}
        </SettingRow>
      ) : null}
    </>
  )
}
