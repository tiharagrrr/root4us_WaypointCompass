// Figma: the desktop chrome behind the store frames (M1 185:10376) and the dispatcher frames
// (03 185:12856): a 232 px sidebar with the wordmark, the nav and the account card, and a header
// carrying the page title, the page's own actions, a status slot and the notification bell.
// The frames are 1440 wide. Below 768 px (a store manager's phone) the sidebar gives way to a bar
// with the wordmark and the nav as one scrolling row, and the account card moves to the foot.
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/lib/use-media-query'
import { Icon, type IconName } from '@/ui/icon'
import { AccountMenu } from '@/features/identity/account-menu'
import { Wordmark } from '@/ui/wordmark'
import { useEventStream } from '@/realtime/use-event-stream'
import { useRouteHandle } from '../route-handle'
import { HeaderSlotContext, PageHeaderContext, type PageHeader } from './header-slot'
import { NotificationBell } from '@/features/notifications/notification-bell'

export interface ShellNavItem {
  to: string
  label: string
  icon: IconName
  /** The count right of the label (214 orders, 7 deferrals), when the shell knows it. */
  count?: number
  /** Stay active on child routes too; the default is an exact match. */
  deep?: boolean
  /** Other paths (and their children) that belong to this item, e.g. 21 under Tracking. */
  alsoActive?: readonly string[]
}

export interface DesktopShellProps {
  /** Small capitals over the nav, and the nav's accessible name: "DISPATCH · PELIYAGODA". */
  navLabel: string
  nav: readonly ShellNavItem[]
  /** Small capitals over the page title when the route sets none: "STORE · FRESH KADAWATHA". */
  eyebrow: string
  /** The page title when the route sets none. */
  title: string
  /** Right of the page actions: the demo-time badge. */
  headerStatus?: ReactNode
  /** Left of the page actions: the dispatcher's depot switch. */
  headerLead?: ReactNode
  /** Where the person is working (the store manager's outlet), kept after every page's eyebrow. */
  place?: string
}

/** "ORDERS" becomes "ORDERS · FRESH KADAWATHA", unless the page's eyebrow already names the place. */
const withPlace = (eyebrow: string, place: string | undefined): string =>
  !place || eyebrow.toLowerCase().includes(place.toLowerCase()) ? eyebrow : `${eyebrow} · ${place}`

export function DesktopShell({ navLabel, nav, eyebrow, title, headerStatus, headerLead, place }: DesktopShellProps) {
  useEventStream()
  const handle = useRouteHandle()
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
  const [pageHeader, setPageHeader] = useState<PageHeader | null>(null)
  const { pathname } = useLocation()
  // One nav in the page at a time, so assistive tech never meets it twice.
  const wide = useMediaQuery('(min-width: 768px)')
  const belongs = (item: ShellNavItem) => (item.alsoActive ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`))

  /** The nav's links: stacked in the sidebar, or one row of pills in the phone's bar. */
  const links = (row: boolean) =>
    nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={!item.deep}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-2.5 rounded-md p-2 no-underline transition-colors duration-100',
                    row && 'shrink-0 whitespace-nowrap',
                    isActive || belongs(item) ? 'bg-accent text-primary' : 'text-foreground hover:bg-slate-100',
                  )
                }
              >
                {({ isActive: exact }) => {
                  const isActive = exact || belongs(item)
                  return (
                  <>
                    <Icon name={item.icon} size={17} className={isActive ? 'text-primary' : 'text-slate-500'} />
                    <span className={cn(!row && 'flex-1', 'font-sans text-[13px] leading-auto', isActive ? 'font-bold' : 'font-medium')}>{item.label}</span>
                    {item.count !== undefined ? (
                      <span className={cn('font-mono text-[11px] leading-auto', isActive ? 'font-semibold text-primary' : 'font-medium text-muted-foreground')}>
                        {item.count}
                      </span>
                    ) : null}
                  </>
                  )
                }}
              </NavLink>
    ))

  return (
    <PageHeaderContext.Provider value={setPageHeader}>
    <HeaderSlotContext.Provider value={actionsSlot}>
      <div className="flex min-h-svh bg-background text-foreground">
        {wide ? (
        <aside className="sticky top-0 flex h-svh w-[232px] shrink-0 flex-col gap-[18px] border-r border-border bg-background py-[18px] pl-3 pr-[13px]">
          <div className="border-b border-border px-2 pb-[15px]">
            <Wordmark />
          </div>
          <nav aria-label={navLabel} className="flex flex-col gap-0.5">
            <p className="m-0 px-2 pb-1.5 font-mono text-[10px] leading-auto tracking-[0.4px] text-slate-400">{navLabel}</p>
            {links(false)}
          </nav>
          <div className="flex-1" />
          <AccountMenu />
        </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {wide ? null : (
            <div className="flex flex-col gap-2 border-b border-border px-4 pb-2 pt-3">
              <div className="flex items-center justify-between gap-3">
                <Wordmark />
                <p className="m-0 truncate font-mono text-[10px] leading-auto tracking-[0.4px] text-slate-400">{navLabel}</p>
              </div>
              <nav aria-label={navLabel} className="-mx-1 flex gap-1 overflow-x-auto px-1">
                {links(true)}
              </nav>
            </div>
          )}
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-slate-200 px-4 pb-[17px] pt-4 md:px-6">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="type-label m-0 uppercase text-muted-foreground">{withPlace(pageHeader?.eyebrow ?? handle.eyebrow ?? eyebrow, place)}</p>
              <h1 className="type-page-title m-0 truncate text-foreground">{pageHeader?.title ?? handle.title ?? title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {headerLead}
              <div ref={setActionsSlot} data-slot="header-actions" className="peer flex flex-wrap items-center gap-2" />
              <div className="px-1 peer-empty:hidden" aria-hidden="true">
                <div className="h-6 w-px bg-slate-200" />
              </div>
              {headerStatus}
              <NotificationBell />
            </div>
          </header>
          <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
            <Outlet />
          </main>
          {wide ? null : (
            <div className="border-t border-border px-4 py-3">
              <AccountMenu />
            </div>
          )}
        </div>
      </div>
    </HeaderSlotContext.Provider>
    </PageHeaderContext.Provider>
  )
}
