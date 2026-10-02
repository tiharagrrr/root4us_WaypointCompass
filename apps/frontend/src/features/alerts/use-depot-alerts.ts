import { useAlertsList, type AlertDto, type AlertDtoType } from '@compass/api-client'

export interface DepotAlertsQuery {
  depotId: string
  /** One type, or every type when left out. */
  type?: AlertDtoType
  /** The trip 19a is showing. */
  tripId?: string
  /** Statuses to include, comma-separated; every status when left out. */
  status?: string
  limit?: number
}

export interface DepotAlerts {
  alerts: AlertDto[]
  /** Alerts still waiting on someone, which is what the panels count. */
  open: AlertDto[]
  total: number
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

/**
 * The depot's alerts, worst first.
 *
 * The server orders them — open before acknowledged before resolved, then
 * severity — so no screen re-sorts the list and the banner, the panel and
 * the column can never disagree about what is most urgent (AC-ALR-09).
 *
 * `filter[depotId]` is always sent. A dispatcher scoped to one depot would
 * be filtered to it anyway, but one who covers every depot would otherwise
 * see Kandy's problems in Peliyagoda's panel, and 01, 19 and 19a are each
 * one depot's view.
 */
export function useDepotAlerts({ depotId, type, tripId, status, limit }: DepotAlertsQuery): DepotAlerts {
  const query = useAlertsList({
    'filter[depotId]': depotId,
    ...(type ? { 'filter[type]': type } : {}),
    ...(tripId ? { 'filter[tripId]': tripId } : {}),
    ...(status ? { 'filter[status]': status } : {}),
    ...(limit ? { limit } : {}),
  })
  const alerts = query.data?.data ?? []
  return {
    alerts,
    open: alerts.filter((alert) => alert.status !== 'RESOLVED'),
    total: query.data?.meta.page?.total ?? alerts.length,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}
