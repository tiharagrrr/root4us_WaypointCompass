import type { ScopeNamesDto, UserRole } from '@compass/api-client'

interface Scoped {
  role: UserRole
  depotId: string | null
  outletId: string | null
  vehicleId: string | null
  scopeNames: ScopeNamesDto
}

/**
 * A1's "Linked to" column: "Outlet · Fresh Kadawatha", "Depot · Peliyagoda",
 * "Vehicle · REF-07 · WP CBA-1234". A dispatcher with no depot sees every depot.
 */
export function scopeLabel(s: Scoped): string {
  if (s.role === 'store_manager' && s.outletId) return `Outlet · ${s.scopeNames.outlet ?? s.outletId}`
  if (s.role === 'driver' && s.vehicleId) return `Vehicle · ${s.scopeNames.vehicle ?? s.vehicleId}`
  if (s.depotId) return `Depot · ${s.scopeNames.depot ?? s.depotId}`
  if (s.role === 'dispatcher') return 'All depots'
  if (s.role === 'admin') return 'Everything'
  return '—'
}

/** "+94771234567" reads as "+94 77 123 4567". */
export function formatPhone(phone: string): string {
  const match = /^\+94(\d{2})(\d{3})(\d{4})$/.exec(phone)
  return match ? `+94 ${match[1]} ${match[2]} ${match[3]}` : phone
}
