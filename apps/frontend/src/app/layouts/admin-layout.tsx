// Figma: A1 Users · 185:8751 (the admin chrome: sidebar, account card and header)
import { useMeGet } from '@compass/api-client'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'
import { initials, roleLabel } from '@/lib/roles'
import { CountBadge } from '@/ui/badge'
import { Icon, type IconName } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { Wordmark } from '@/ui/wordmark'
import { useRouteHandle } from '../route-handle'
import { AdminHeaderSlotContext } from './admin-header-slot'

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
  /** Unread notifications for the bell's badge. */
  notificationCount?: number
}

export function AdminLayout({ headerStatus, navCounts = {}, notificationCount }: AdminLayoutProps) {
  const { title } = useRouteHandle()
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)

  return (
    <AdminHeaderSlotContext.Provider value={actionsSlot}>
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
          <AccountCard />
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
              <button
                type="button"
                aria-label={notificationCount ? `Notifications, ${notificationCount} unread` : 'Notifications'}
                className="relative flex size-9 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-background text-slate-700 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Icon name="bell" size={18} />
                {notificationCount ? <CountBadge className="absolute left-[22px] top-[-6px]">{notificationCount}</CountBadge> : null}
              </button>
            </div>
          </header>
          <main className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4">
            <Outlet />
          </main>
        </div>
      </div>
    </AdminHeaderSlotContext.Provider>
  )
}

/** The signed-in admin at the foot of the sidebar (GET /me). */
function AccountCard() {
  const me = useMeGet()
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-2 pt-[13px]">
      {me.data ? (
        <>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-sans text-[12px] font-bold text-primary">
            {initials(me.data.data.name)}
          </span>
          <div className="flex min-w-0 flex-col gap-px leading-auto">
            <span className="truncate font-sans text-[13px] font-bold text-foreground">{me.data.data.name}</span>
            <span className="type-caption truncate text-muted-foreground">{roleLabel(me.data.data.role)}</span>
          </div>
        </>
      ) : me.isPending ? (
        <>
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        </>
      ) : (
        <span className="type-caption text-muted-foreground">Not signed in</span>
      )}
    </div>
  )
}
