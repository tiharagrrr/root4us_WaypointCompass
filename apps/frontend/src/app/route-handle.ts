import { useMatches } from 'react-router'

/** What a route tells its shell: the page title in the header, and the small capitals above it. */
export interface RouteHandle {
  title?: string
  /** Overrides the shell's own eyebrow, for a breadcrumb like "NEW ORDER · FRESH KADAWATHA". */
  eyebrow?: string
  /**
   * Driver frames only. The tab bar belongs to the home-level screens (D1, D2, D10, D12, D14); a
   * live trip hides it so the driver stays on the task (the Tab bar component's own note in Figma,
   * 243:743). Routes say nothing and keep it.
   */
  tabBar?: boolean
}

const isHandle = (value: unknown): value is RouteHandle =>
  typeof value === 'object' &&
  value !== null &&
  (typeof (value as RouteHandle).title === 'string' ||
    typeof (value as RouteHandle).eyebrow === 'string' ||
    typeof (value as RouteHandle).tabBar === 'boolean')

/** The matched route handles, merged from the root down, so the deepest route wins each field. */
export const useRouteHandle = (): RouteHandle => {
  const matches = useMatches()
  const handle: RouteHandle = {}
  for (const match of matches) {
    if (!isHandle(match.handle)) continue
    if (match.handle.title !== undefined) handle.title = match.handle.title
    if (match.handle.eyebrow !== undefined) handle.eyebrow = match.handle.eyebrow
    if (match.handle.tabBar !== undefined) handle.tabBar = match.handle.tabBar
  }
  return handle
}
