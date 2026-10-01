import type { ScopeOptionsDto, UserRole } from '@compass/api-client'

/** One "Link to" option (A2): what the person will see, as the API's scope fields. */
export interface ScopeChoice {
  value: string
  label: string
  depotId: string | null
  outletId: string | null
  vehicleId: string | null
}

const none = { depotId: null, outletId: null, vehicleId: null }

/**
 * The "Link to" options for a role: an outlet for a store manager, a depot for a loader or a
 * dispatcher (who may also see all depots), a vehicle for a driver, nothing for an admin.
 */
export function scopeChoices(role: UserRole, options: ScopeOptionsDto | undefined): ScopeChoice[] {
  if (!options) return []
  const depots = options.depots.map((d) => ({ ...none, value: `depot:${d.id}`, label: `Depot · ${d.name}`, depotId: d.id }))
  switch (role) {
    case 'store_manager':
      return options.outlets.map((o) => ({ ...none, value: `outlet:${o.id}`, label: `Outlet · ${o.name}`, outletId: o.id }))
    case 'dispatcher':
      return [{ ...none, value: 'all', label: 'All depots' }, ...depots]
    case 'loader':
      return depots
    case 'driver':
      return options.vehicles.map((v) => ({
        ...none,
        value: `vehicle:${v.id}`,
        label: `Vehicle · ${v.code} · ${v.registrationNo}`,
        vehicleId: v.id,
        depotId: v.depotId,
      }))
    case 'admin':
      return [{ ...none, value: 'all', label: 'Everything' }]
  }
}

/** The option that matches a user's current scope, if any. */
export function currentChoice(
  role: UserRole,
  scope: { depotId: string | null; outletId: string | null; vehicleId: string | null },
): string | undefined {
  if (role === 'store_manager' && scope.outletId) return `outlet:${scope.outletId}`
  if (role === 'driver' && scope.vehicleId) return `vehicle:${scope.vehicleId}`
  if ((role === 'loader' || role === 'dispatcher') && scope.depotId) return `depot:${scope.depotId}`
  if (role === 'dispatcher' || role === 'admin') return 'all'
  return undefined
}

/** Roles A2 can invite, in the frame's order. Admins are made by changing a role. */
export const INVITABLE_ROLES = [
  { value: 'store_manager', label: 'Store manager' },
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'loader', label: 'Loader' },
  { value: 'driver', label: 'Driver' },
] as const satisfies readonly { value: UserRole; label: string }[]
