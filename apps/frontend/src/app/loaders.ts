import type { QueryClient } from '@tanstack/react-query'
import { queryClient } from './query-client'

/**
 * A route loader that starts prefetching and returns at once, so navigation never waits on the
 * network and the screen shows its skeleton until the data lands:
 *   loader: prefetchLoader((qc) => qc.prefetchQuery(getUsersListQueryOptions({ limit: 10 })))
 */
export const prefetchLoader = (start: (client: QueryClient) => Promise<unknown>) => () => {
  void start(queryClient)
  return null
}
