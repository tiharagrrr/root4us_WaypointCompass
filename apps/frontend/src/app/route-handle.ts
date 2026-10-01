import { useMatches } from 'react-router'

/** What a route tells its shell: the page title in the header. */
export interface RouteHandle {
  title?: string
}

const isHandle = (value: unknown): value is RouteHandle =>
  typeof value === 'object' && value !== null && typeof (value as RouteHandle).title === 'string'

/** The deepest matched route's handle that has a title. */
export const useRouteHandle = (): RouteHandle => {
  const matches = useMatches()
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const handle = matches[i]?.handle
    if (isHandle(handle)) return handle
  }
  return {}
}
