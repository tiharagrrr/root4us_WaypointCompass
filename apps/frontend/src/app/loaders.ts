import type { QueryClient } from '@tanstack/react-query'
import type { LoaderFunctionArgs, Params } from 'react-router'
import { queryClient } from './query-client'

/**
 * A route loader that starts prefetching and returns at once, so navigation never waits on the
 * network and the screen shows its skeleton until the data lands:
 *   loader: prefetchLoader((qc) => qc.prefetchQuery(getUsersListQueryOptions({ limit: 10 })))
 *
 * The route's own params come second, for the screens keyed by one:
 *   loader: prefetchLoader((qc, { id }) => qc.prefetchQuery(getTripLoadingLoadListQueryOptions(id!)))
 */
export const prefetchLoader =
  (start: (client: QueryClient, params: Params) => Promise<unknown>) =>
  ({ params }: LoaderFunctionArgs) => {
    void start(queryClient, params)
    return null
  }
