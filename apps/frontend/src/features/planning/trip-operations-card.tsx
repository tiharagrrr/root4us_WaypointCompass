// Figma: 19a Trip details · 464:1966, the Reassign and Re-sequence buttons that open 20 and 19b.
import {
  getPlansTripsQueryKey,
  getTripsGetQueryKey,
  usePlanBuildingVehicleOptions,
  usePlansDriverOptions,
  usePlansForDay,
  usePlansTrips,
  useTripOperationsRepairOptions,
  useTripsGet,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Card, CardContent } from '@/ui/card'
import { ErrorState } from '@/ui/states'
import { ReassignDialog } from './reassign-dialog'
import { ResequenceDialog } from './resequence-dialog'

const CANT_RUN: Record<string, string> = {
  BREAKDOWN: 'The driver reported a breakdown.',
  COOLING: 'The driver reported a cooling fault.',
  UNWELL: 'The driver is unwell.',
  OTHER: 'The driver cannot run this trip.',
}

/**
 * What a dispatcher can change about one trip from 19a. The buttons come from the trip's own
 * `reassign` and `resequence` links (rule 9), so a finished trip shows neither. The dialogs read
 * the trip as its plan holds it (load, stops, windows) and the plan's vehicle options.
 */
export function TripOperationsCard({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<'reassign' | 'resequence' | null>(null)
  const summary = useTripsGet(tripId).data?.data
  const plan = usePlansForDay(summary?.depotId ?? '', summary?.date ?? '', { query: { enabled: Boolean(summary) } }).data?.data
  const planId = plan?.id ?? ''
  const trips = usePlansTrips(planId, { query: { enabled: planId !== '' } })
  const vehicles = usePlanBuildingVehicleOptions(planId, { query: { enabled: open === 'reassign' && planId !== '' } })
  const drivers = usePlansDriverOptions(planId, { query: { enabled: open === 'reassign' && planId !== '' } })
  const repairs = useTripOperationsRepairOptions(tripId, { query: { enabled: open === 'reassign' } })
  const trip = trips.data?.data.find((t) => t.id === tripId)
  const reassign = getLink(summary?._links, 'reassign')
  const resequence = getLink(summary?._links, 'resequence')
  if (!summary || (!reassign && !resequence)) return null

  const done = () => {
    setOpen(null)
    void queryClient.invalidateQueries({ queryKey: getTripsGetQueryKey(tripId) })
    if (planId) void queryClient.invalidateQueries({ queryKey: getPlansTripsQueryKey(planId) })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <h3 className="type-card-title m-0 text-foreground">Change this trip</h3>
        <p className="type-body-small m-0 text-muted-foreground">Each change is a revision with a reason; the people it touches are told.</p>
        {/* Without the plan's trips the dialogs have nothing to show: say why the buttons wait. */}
        {trips.isError ? <ErrorState error={trips.error} onRetry={() => void trips.refetch()} /> : null}
        <div className="flex gap-2">
          <Action link={reassign} variant="default" disabled={!trip} onAction={() => setOpen('reassign')}>
            Reassign
          </Action>
          <Action link={resequence} variant="outline" disabled={!trip} onAction={() => setOpen('resequence')}>
            Re-sequence
          </Action>
        </div>
      </CardContent>
      {open === 'reassign' && trip && reassign && plan ? (
        <ReassignDialog
          trip={trip}
          vehicles={vehicles.data?.data ?? []}
          drivers={drivers.data?.data ?? []}
          repairs={repairs.data?.data}
          link={reassign}
          version={summary.version}
          revision={plan.revision}
          because={summary.cantRunReason ? CANT_RUN[summary.cantRunReason] : null}
          optionsError={vehicles.error ?? drivers.error ?? repairs.error ?? undefined}
          onRetryOptions={() => {
            void vehicles.refetch()
            void drivers.refetch()
            void repairs.refetch()
          }}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
      {open === 'resequence' && trip && resequence && plan ? (
        <ResequenceDialog
          trip={trip}
          link={resequence}
          deferLink={summary._links.deferStop}
          version={summary.version} revision={plan.revision} onClose={() => setOpen(null)} onDone={done} />
      ) : null}
    </Card>
  )
}
