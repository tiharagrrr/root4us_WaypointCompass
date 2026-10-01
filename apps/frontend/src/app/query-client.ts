import { isApiProblem } from '@compass/api-client'
import { QueryClient } from '@tanstack/react-query'

/**
 * Queries retry once, never on a 4xx (specs/api-conventions.md, section 9); mutations never retry
 * on their own. Route loaders import this to prefetch.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => failureCount < 1 && !(isApiProblem(error) && error.status < 500),
    },
    mutations: { retry: false },
  },
})
