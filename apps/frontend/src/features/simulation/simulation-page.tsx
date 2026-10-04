// No Figma frame: the run controls were built from A6's setting rows (specs/simulation/spec.md).
import { useClockGet, useSimulationsList } from '@compass/api-client'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { SimulationSection } from './simulation-section'

/**
 * The dispatcher's own simulation screen. The panel itself is shared with A6 → Demo, because
 * admins and dispatchers both hold `simulation:run`; what this page adds is the way in and the
 * reason the panel is blank, which a settings row could leave unsaid: demo mode off, the simulator
 * off on the server, or a clock that did not load.
 */
export function SimulationPage() {
  const clock = useClockGet({ query: { retry: false } })
  // The same query key the panel uses, so this costs no extra request.
  const runs = useSimulationsList({ query: { retry: false } })

  if (clock.isError) return <ErrorState error={clock.error} onRetry={() => void clock.refetch()} />
  if (!clock.data) return <Skeleton className="h-40 w-full" />

  if (!clock.data.data.demoMode)
    return (
      <EmptyState
        title="Demo mode is off"
        description="The simulator plays a demo day, so it runs only with DEMO_MODE=true. Nothing here affects a real day."
      />
    )

  if (runs.isPending) return <Skeleton className="h-40 w-full" />

  // The endpoints answer 404 unless SIMULATION_ENABLED, which is a setup fact, not an error.
  if (!runs.data)
    return (
      <EmptyState
        title="The simulator is off"
        description="Set SIMULATION_ENABLED=true and run the worker (pnpm --filter api dev:worker) to play a published plan at 60 times real speed."
      />
    )

  return (
    <div className="flex flex-col">
      <SimulationSection clock={clock.data.data} />
    </div>
  )
}
