import type { UserRole } from '@waypoint/shared'
import { Link } from 'react-router'

export interface RoleRoute {
  role: Exclude<UserRole, 'admin'>
  path: string
  label: string
  summary: string
}

/** One app, role-based routes; each role gets its own layout and screens. */
export const ROLE_ROUTES: RoleRoute[] = [
  {
    role: 'dispatcher',
    path: '/dispatch',
    label: 'Dispatcher',
    summary: 'Close the order queue, run allocation, review deferrals, track progress.',
  },
  {
    role: 'loader',
    path: '/load',
    label: 'Loader',
    summary: 'Load in reverse stop order, flag missing or damaged items, release vehicles.',
  },
  {
    role: 'driver',
    path: '/drive',
    label: 'Driver',
    summary: 'Follow the route, record each stop and proof of delivery, even offline.',
  },
  {
    role: 'store_manager',
    path: '/store',
    label: 'Store manager',
    summary: 'Place orders before 4 PM, see ETAs and deferral notices, confirm receipt.',
  },
]

export function RolePlaceholder({ route }: { route: RoleRoute }) {
  return (
    <main className="shell">
      <p>
        <Link to="/">← All roles</Link>
      </p>
      <h1>{route.label}</h1>
      <p>{route.summary}</p>
      <p className="muted">Screens from the Designathon submission go here.</p>
    </main>
  )
}
