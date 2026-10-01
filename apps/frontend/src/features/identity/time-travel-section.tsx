// Figma: A6 Settings · 185:10227 (Demo; time travel and reset are in the spec, not drawn in the frame)
import { getClockGetQueryKey, isApiProblem, useClockSet, useDemoReset, type ClockDto, type SetClockDto } from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { toast } from '@/ui/toast-store'
import { SettingRow } from './setting-row'

const MODE_TEXT: Record<string, string> = {
  real: 'Running at real time.',
  offset: 'Running, shifted from real time.',
  frozen: 'Stopped.',
  simulated: 'Driven by a simulation run.',
}

/** "2026-10-01T15:55:00+05:30" as the value of a datetime-local input (Colombo wall time). */
const toLocalInput = (iso: string) => iso.slice(0, 16)

/**
 * A6 time travel (PUT /clock) and Reset demo day (POST /demo/reset), both demo mode only. Every
 * screen follows the demo clock within 5 seconds, and the header badge shows it.
 */
export function TimeTravelSection({ clock }: { clock: ClockDto }) {
  const queryClient = useQueryClient()
  const setClock = useClockSet()
  const reset = useDemoReset()
  const [at, setAt] = useState(toLocalInput(clock.now))
  const [error, setError] = useState<string | null>(null)
  const canSet = Boolean(getLink(clock._links, 'set'))

  const travel = async (body: SetClockDto, done: string) => {
    setError(null)
    try {
      await setClock.mutateAsync({ data: body })
    } catch (e) {
      setError(isApiProblem(e) ? (e.errors[0]?.message ?? e.detail ?? e.title) : 'The clock did not change.')
      return
    }
    await queryClient.invalidateQueries()
    toast({ title: done, tone: 'success' })
  }
  const atIso = `${at}:00+05:30`

  return (
    <>
      <SettingRow
        title="Time travel"
        description={
          <>
            Demo time {formatColombo(clock.now, 'EEE d MMM HH:mm')}. {MODE_TEXT[clock.mode] ?? ''}
          </>
        }
        error={error ?? undefined}
      >
        {canSet ? (
          <div className="flex flex-col gap-2">
            <Input type="datetime-local" aria-label="Demo time" value={at} onChange={(e) => setAt(e.target.value)} className="w-[220px] font-mono" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" loading={setClock.isPending} onClick={() => void travel({ mode: 'frozen', at: atIso }, 'Demo clock stopped')}>
                Freeze here
              </Button>
              <Button size="sm" variant="outline" loading={setClock.isPending} onClick={() => void travel({ mode: 'offset', at: atIso }, 'Demo clock moved')}>
                Run from here
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={clock.mode === 'real'}
                loading={setClock.isPending}
                onClick={() => void travel({ mode: 'real' }, 'Back to real time')}
              >
                Back to real time
              </Button>
            </div>
          </div>
        ) : null}
      </SettingRow>
      <SettingRow title="Reset demo day" description="Puts the orders and trips around the demo day back as seeded, and empties the demo inbox.">
        <Action
          variant="destructive"
          className="self-start"
          link={clock._links.reset}
          confirm={{ title: 'Reset the demo day?', description: 'Changes made during the walkthrough to the seeded days are lost.', confirmLabel: 'Reset' }}
          onAction={async () => {
            try {
              await reset.mutateAsync()
            } catch (e) {
              toast({ title: 'Reset did not run', description: isApiProblem(e) ? (e.detail ?? e.title) : undefined, tone: 'danger' })
              return
            }
            await queryClient.invalidateQueries({ queryKey: getClockGetQueryKey() })
            toast({ title: 'Demo day reset', tone: 'success' })
          }}
        />
      </SettingRow>
    </>
  )
}
