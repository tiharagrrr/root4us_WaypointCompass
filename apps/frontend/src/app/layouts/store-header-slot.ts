import { createContext } from 'react'

/** The header toolbar element where a store screen portals its actions (M1's two preset buttons). */
export const StoreHeaderSlotContext = createContext<HTMLElement | null>(null)
