import { useMatches } from 'react-router'

/** What a route tells its shell: the page title in the header, and the small capitals above it. */
export interface RouteHandle {
  title?: string
  /** Overrides the shell's own eyebrow, for a breadcrumb like "NEW ORDER · FRESH KADAWATHA". */
  eyebrow?: string
}

const isHandle = (value: unknown): value is RouteHandle =>
  typeof value === 'object' &&
  value !== null &&
  (typeof (value as RouteHandle).title === 'string' || typeof (value as RouteHandle).eyebrow === 'string')

/** The matched route handles, merged from the root down, so the deepest route wins each field. */
export const useRouteHandle = (): RouteHandle => {
  const matches = useMatches()
  const handle: RouteHandle = {}
  for (const match of matches) {
    if (!isHandle(match.handle)) continue
    if (match.handle.title !== undefined) handle.title = match.handle.title
    if (match.handle.eyebrow !== undefined) handle.eyebrow = match.handle.eyebrow
  }
  return handle
}
