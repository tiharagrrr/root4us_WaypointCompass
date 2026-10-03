import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { addDays } from '@waypoint/shared'
import { useParams } from 'react-router'
import { useDepot } from '@/app/layouts/depot-context'
import { toColomboDate } from '@/lib/format-colombo'
import { useServerClock } from '@/lib/server-clock'
import { dayLabel } from './plan-copy'
import { usePlanDay } from './use-plan-day'

/** What steps 2 to 4 (14 to 18) share: the route's day, its plan, trips and orders left over. */
export function usePlanStep() {
  const { date = '' } = useParams()
  const { depot } = useDepot()
  const { now } = useServerClock(30_000)
  const tomorrow = addDays(toColomboDate(now), 1)
  const day = usePlanDay(depot, date)
  const plan = day.plan.data?.data
  return {
    date,
    tomorrow,
    now,
    depot,
    depotName: DEPOT_NAMES[depot] ?? depot,
    /** "Tomorrow" or "Fri 2 Oct", for titles. */
    dayWord: date === tomorrow ? 'Tomorrow' : dayLabel(date),
    day,
    plan,
    trips: day.trips.data?.data ?? [],
    unplanned: day.unplanned.data?.data ?? [],
  }
}

export type PlanStep = ReturnType<typeof usePlanStep>
