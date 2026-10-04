// Figma: A1 Users · 185:8751 (the admin chrome: sidebar, account card and header)
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/ui/icon'
import { AccountMenu } from '@/features/identity/account-menu'
import { Wordmark } from '@/ui/wordmark'
import { useEventStream } from '@/realtime/use-event-stream'
import { useRouteHandle } from '../route-handle'
import { HeaderSlotContext } from './header-slot'
import { NotificationBell } from '@/features/notifications/notification-bell'

export type AdminSection = 'users' | 'outlets' | 'depots' | 'vehicles' | 'settings'

const NAV: readonly { section: AdminSection; label: string; icon: IconName }[] = [
  { section: 'users', label: 'Users', icon: 'users' },
  { section: 'outlets', label: 'Outlets', icon: 'outlets' },
  { section: 'depots', label: 'Depots', icon: 'depots' },
  { section: 'vehicles', label: 'Vehicles', icon: 'vehicles' },
  { section: 'settings', label: 'Settings', icon: 'settings' },
]

export interface AdminLayoutProps {
  /** Header slot right of the page actions, for <DemoTimeBadge> once GET /clock is wired. */
  headerStatus?: ReactNode
  /** Counts beside the nav items (42 users, 120 outlets, ...), when known. */
  navCounts?: Partial<Record<AdminSection, number>>
}

export function AdminLayout({ headerStatus, navCounts = {} }: AdminLayoutProps) {
  useEventStream()
  const { title } = useRouteHandle()
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)

  return (
    <HeaderSlotContext.Provider value={actionsSlot}>
      <div className="flex min-h-svh bg-background text-foreground">
        <aside className="sticky top-0 flex h-svh w-[232px] shrink-0 flex-col gap-[18px] border-r border-border bg-background py-[18px] pl-3 pr-[13px]">
          <div className="border-b border-border px-2 pb-[15px]">
            <Wordmark />
          </div>
          <nav aria-label="Admin" className="flex flex-col gap-0.5">
            <p className="m-0 px-2 pb-1.5 font-mono text-[10px] leading-auto tracking-[0.4px] text-slate-400">SUPER ADMIN</p>
            {NAV.map((item) => (
              <NavLink
                key={item.section}
                to={`/admin/${item.section}`}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-2.5 rounded-md p-2 no-underline transition-colors duration-100',
                    isActive ? 'bg-accent text-primary' : 'text-foreground hover:bg-slate-100',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon name={item.icon} size={17} className={isActive ? 'text-primary' : 'text-slate-500'} />
                    <span className={cn('flex-1 font-sans text-[13px] leading-auto', isActive ? 'font-bold' : 'font-medium')}>{item.label}</span>
                    {navCounts[item.section] !== undefined ? (
                      <span className={cn('font-mono text-[11px] leading-auto', isActive ? 'font-semibold text-primary' : 'font-medium text-muted-foreground')}>
                        {navCounts[item.section]}
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <AccountMenu />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 pb-[17px] pt-4">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="type-label m-0 uppercase text-muted-foreground">Admin · Waypoint Lanka</p>
              <h1 className="type-page-title m-0 truncate text-foreground">{title ?? 'Admin'}</h1>
            </div>
            <div className="flex items-center gap-2">
              <div ref={setActionsSlot} data-slot="admin-header-actions" className="peer flex items-center gap-2" />
              <div className="px-1 peer-empty:hidden" aria-hidden="true">
                <div className="h-6 w-px bg-slate-200" />
              </div>
              {headerStatus}
              <NotificationBell />
            </div>
          </header>
          <main className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4">
            <Outlet />
          </main>
        </div>
      </div>
    </HeaderSlotContext.Provider>
  )
}
