import type { RouteObject } from 'react-router'
import { RolePlaceholder } from '../role-placeholder'
import { ROLE_ROUTES } from '../role-routes'

/**
 * Shells not built yet. When a role gets its own src/app/routes/<role>.tsx, drop it from here.
 */
export const rolePlaceholderRoutes: RouteObject[] = ROLE_ROUTES.filter((r) => r.role !== 'admin').map((route) => ({
  path: `${route.path.slice(1)}/*`,
  element: <RolePlaceholder route={route} />,
}))
