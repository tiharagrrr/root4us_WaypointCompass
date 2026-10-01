import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HeaderSlotContext } from './header-slot'

/**
 * Puts a page's toolbar in its shell's header, left of the divider, as in A1 (search, role filter,
 * Invite user) and M1 (Load a saved preset). Renders nothing outside a desktop shell.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext)
  return slot ? createPortal(children, slot) : null
}
