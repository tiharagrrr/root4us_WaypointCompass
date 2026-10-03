import {
  getPlanBuildingVehicleOptionsQueryKey,
  getPlansContextQueryKey,
  getPlansForDayQueryKey,
  getPlansGetQueryKey,
  getPlansTripsQueryKey,
  getPlansUnplannedQueryKey,
  usePlanBuildingVehicleOptions,
  usePlansContext,
  usePlansForDay,
  usePlansTrips,
  usePlansUnplanned,
} from '@compass/api-client'
import type { EngineInput, Plan } from '@waypoint/engine'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

/**
 * Everything 05 and 09 read for one depot's day: the plan (opened as a draft on first access),
 * the orders on no trip, the trips, the vehicles, and the engine context the wizard runs the
 * engine on in the browser (AC-PLN-12).
 */
export function usePlanDay(depotId: string, date: string) {
  const queryClient = useQueryClient()
  const plan = usePlansForDay(depotId, date)
  const id = plan.data?.data.id ?? ''
  const enabled = id !== ''
  const unplanned = usePlansUnplanned(id, { query: { enabled } })
  const trips = usePlansTrips(id, { query: { enabled } })
  const vehicles = usePlanBuildingVehicleOptions(id, { query: { enabled } })
  const context = usePlansContext(id, { query: { enabled } })

  const engine = useMemo(() => {
    const ctx = context.data?.data
    if (!ctx) return undefined
    // The context is the engine's EngineInput and Plan (planning's PlanContextDto).
    return { input: ctx.input as unknown as EngineInput, plan: ctx.plan as unknown as Plan, version: ctx.version }
  }, [context.data])

  /** After a write: everything about this day may have changed. */
  const refresh = useCallback(async () => {
    const keys = [
      getPlansForDayQueryKey(depotId, date),
      ...(enabled
        ? [
            getPlansGetQueryKey(id),
            getPlansUnplannedQueryKey(id),
            getPlansTripsQueryKey(id),
            getPlanBuildingVehicleOptionsQueryKey(id),
            getPlansContextQueryKey(id),
          ]
        : []),
    ]
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  }, [queryClient, depotId, date, id, enabled])

  return {
    plan,
    unplanned,
    trips,
    vehicles,
    context,
    engine,
    refresh,
    isPending: plan.isPending || (enabled && (unplanned.isPending || trips.isPending || vehicles.isPending)),
  }
}

export type PlanDay = ReturnType<typeof usePlanDay>
