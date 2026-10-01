import { createContext } from 'react'

/** The header toolbar element where a page portals its actions (search, filters, primary button). */
export const AdminHeaderSlotContext = createContext<HTMLElement | null>(null)
