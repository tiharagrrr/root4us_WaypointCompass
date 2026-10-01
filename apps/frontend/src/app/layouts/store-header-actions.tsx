import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { StoreHeaderSlotContext } from './store-header-slot'

/**
 * Puts a screen's toolbar in the store header, left of the divider, as in M1 ("Load a saved
 * preset", "Save as preset"). Renders nothing outside StoreLayout.
 */
export function StoreHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(StoreHeaderSlotContext)
  return slot ? createPortal(children, slot) : null
}
