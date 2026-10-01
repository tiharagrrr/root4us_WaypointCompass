import type { UserRole } from '@compass/api-client'

/** How each role reads in the UI (A1's Role column, the account card). */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Super admin',
  dispatcher: 'Dispatcher',
  loader: 'Loader',
  driver: 'Driver',
  store_manager: 'Store manager',
}

export const roleLabel = (role: UserRole): string => ROLE_LABELS[role]

/** "Rusiru Withanage" → "RW". */
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
