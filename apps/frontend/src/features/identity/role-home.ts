import type { UserRole } from '@compass/api-client'

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<UserRole, string> = {
  admin: '/admin/users',
  dispatcher: '/dispatch',
  store_manager: '/store',
  loader: '/dock',
  driver: '/driver',
}
