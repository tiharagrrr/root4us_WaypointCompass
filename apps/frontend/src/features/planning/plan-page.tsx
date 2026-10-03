// Figma: 05 Plan · empty · 265:2134 and 09 Plan · vehicles · 268:2245 (one route, by whether the
// day has trips yet)
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { addDays, cutoffFor } from '@waypoint/shared'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { serverNow, useServerClock } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { AddVehicleDialog, type WizardStart } from './add-vehicle-dialog'
import { NotPlannedCard } from './not-planned-card'
import { DayStrip, PlanStepper } from './plan-chrome'
import { dayLabel } from './plan-copy'
import { EmptyPanel, PlanPanel } from './plan-panels'
import { useAutoSuggest } from './use-auto-suggest'
import { usePlanDay } from './use-plan-day'

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/

/** /dispatch/plan opens tomorrow's plan. */
export function PlanIndexRedirect() {
  return <Navigate replace to={`/dispatch/plan/${addDays(toColomboDate(serverNow()), 1)}`} />
}

/**
 * 05 and 09, step 1 of planning: the orders on no trip on the left, and either the two ways to
 * start (05) or the vehicles and their trips (09). Every action comes from the plan's _links.
 */
export function PlanPage() {
  const { date = '' } = useParams()
  const { depot } = useDepot()
  const navigate = useNavigate()
  const { now } = useServerClock(30_000)
  const tomorrow = addDays(toColomboDate(now), 1)
  const valid = BUSINESS_DATE.test(date)
  const day = usePlanDay(depot, valid ? date : tomorrow)
  const [wizard, setWizard] = useState<WizardStart | null>(null)
  const plan = day.plan.data?.data
  const suggest = useAutoSuggest(plan?.id ?? '', day.refresh)

  const trips = day.trips.data?.data ?? []
  const status = !plan ? '' : plan.status === 'DRAFT' ? (trips.length ? 'DRAFT' : 'NOT STARTED') : plan.status
  const shown = valid ? date : tomorrow
  const closed = now.getTime() >= cutoffFor(shown, 960).getTime()
  const dayWord = shown === tomorrow ? 'tomorrow' : dayLabel(shown)
  usePageHeader({
    eyebrow: `PLAN · ${dayLabel(shown).toUpperCase()} · ${trips.length ? status : closed ? 'CUTOFF CLOSED 16:00' : 'ORDERS OPEN'}`,
    title: `Plan · ${shown === tomorrow ? 'Tomorrow' : dayLabel(shown)}`,
  })

  if (!valid) return <Navigate replace to={`/dispatch/plan/${tomorrow}`} />

  const edits = getLink(plan?._links, 'edits')
  const depotName = DEPOT_NAMES[depot] ?? depot

  return (
    <div className="-mx-6 -mb-4 -mt-4 flex min-h-0 flex-1 flex-col">
      {trips.length && edits ? (
        <HeaderActions>
          <Button variant="outline" onClick={() => setWizard({})}>
            + Add vehicle
          </Button>
        </HeaderActions>
      ) : null}
      <DayStrip date={date} tomorrow={tomorrow} now={now} status={status} />
      <PlanStepper step={1} />

      <div className="flex min-h-0 flex-1 items-stretch gap-4 bg-page px-6 py-4">
        {day.plan.isError ? (
          <ErrorState className="flex-1" error={day.plan.error} onRetry={() => void day.plan.refetch()} />
        ) : !plan || day.isPending ? (
          <>
            <Skeleton className="h-[640px] w-[320px]" />
            <Skeleton className="h-[200px] min-w-px flex-1" />
          </>
        ) : (
          <>
            <NotPlannedCard orders={day.unplanned.data?.data} input={day.engine?.input} withReasons={trips.length > 0} />
            {trips.length === 0 ? (
              <EmptyPanel
                orders={plan.summary.unplanned}
                vehicles={day.vehicles.data?.data ?? []}
                dayWord={dayWord}
                actions={
                  <>
                    <Action link={edits} variant="primary" onAction={() => setWizard({})}>
                      Add Trip
                    </Action>
                    <Action
                      link={plan._links.engineRuns}
                      variant="outline"
                      version={plan.version}
                      loading={suggest.running}
                      onAction={({ headers }) => suggest.begin(headers)}
                    >
                      {suggest.running ? 'Auto-suggesting…' : 'Auto-suggest a plan'}
                    </Action>
                  </>
                }
              />
            ) : (
              <PlanPanel
                plan={plan}
                trips={trips}
                vehicles={day.vehicles.data?.data ?? []}
                onEditVehicle={edits ? (vehicleId, tripNo) => setWizard({ vehicleId, tripNo }) : undefined}
                onAddVehicle={edits ? () => setWizard({}) : undefined}
                onConfirm={() => void navigate(`/dispatch/plan/${date}/confirm`)}
              />
            )}
          </>
        )}
      </div>
      {suggest.error || suggest.failed ? (
        <div className="px-6 pb-4">
          <ErrorState error={suggest.error ?? new Error(suggest.failed ?? '')} />
        </div>
      ) : null}

      {plan && wizard ? (
        <AddVehicleDialog
          key={`${wizard.vehicleId ?? 'new'}#${wizard.tripNo ?? ''}`}
          day={day}
          plan={plan}
          depotName={depotName}
          start={wizard}
          onClose={() => setWizard(null)}
        />
      ) : null}
    </div>
  )
}

