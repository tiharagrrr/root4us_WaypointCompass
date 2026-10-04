import { useMeGet } from '@compass/api-client'
import type { UserRole } from '@waypoint/shared/domain'
import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router'
import { ROLE_HOME } from '@/features/identity/role-home'
import { useRegisterDevice } from '@/features/identity/use-register-device'

export interface RoleAreaProps {
  /** The roles this area belongs to. */
  allow: readonly UserRole[]
  /** Rendered when the caller may be here; a layout route leaves this out and gets its Outlet. */
  children?: ReactNode
}

/**
 * Keeps each role inside its own area: a dispatcher who opens a store route lands back on their
 * own home (Step 8 · Frontend, Landing). It is a convenience only — the API checks every request
 * regardless, so a wrong turn here is never what keeps data safe.
 */
export function RoleArea({ allow, children }: RoleAreaProps) {
  const me = useMeGet()
  const role = me.data?.data.role
  // Every signed-in browser registers itself once, so A6 can make it a dock tablet.
  useRegisterDevice(me.data?.data.id)

  // Nothing is known yet: the shell would only flash before the redirect.
  if (me.isPending) return null
  if (role && !allow.includes(role)) return <Navigate to={ROLE_HOME[role]} replace />
  return children ?? <Outlet />
}
