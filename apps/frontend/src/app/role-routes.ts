import type { UserRole } from '@waypoint/shared'

export interface RoleRoute {
  role: UserRole
  path: string
  label: string
  summary: string
}

/** One app, role-based routes; each role gets its own shell and screens. */
export const ROLE_ROUTES: RoleRoute[] = [
  {
    role: 'admin',
    path: '/admin',
    label: 'Admin',
    summary: 'Invite users and scope them, manage outlets, depots and vehicles, set the rules.',
  },
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
