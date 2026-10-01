import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AdminHeaderSlotContext } from './admin-header-slot'

/**
 * Puts a page's toolbar in the admin header, left of the divider, as in A1 (search, role filter,
 * Invite user). Renders nothing outside AdminLayout.
 */
export function AdminHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(AdminHeaderSlotContext)
  return slot ? createPortal(children, slot) : null
}
