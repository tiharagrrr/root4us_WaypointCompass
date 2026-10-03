import { createContext, useContext, useEffect } from 'react'

/** The header toolbar element where a page portals its actions (search, filters, primary button). */
export const HeaderSlotContext = createContext<HTMLElement | null>(null)

/** A title the page works out from its data ("Plan · Tomorrow"), which a route handle cannot. */
export interface PageHeader {
  eyebrow?: string
  title?: string
}

export const PageHeaderContext = createContext<(header: PageHeader | null) => void>(() => undefined)

/**
 * Sets the shell's eyebrow and title while the page is mounted, for headers that depend on the
 * page's data. Static titles stay on the route handle.
 */
export function usePageHeader(header: PageHeader): void {
  const set = useContext(PageHeaderContext)
  const { eyebrow, title } = header
  useEffect(() => {
    set({ eyebrow, title })
    return () => set(null)
  }, [set, eyebrow, title])
}
