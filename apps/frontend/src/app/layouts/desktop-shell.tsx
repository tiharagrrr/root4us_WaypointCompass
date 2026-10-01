// Figma: the desktop chrome behind the store frames (M1 185:10376) and the dispatcher frames
// (03 185:12856): a 232 px sidebar with the wordmark, the nav and the account card, and a header
// carrying the page title, the page's own actions, a status slot and the notification bell.
import { useMeGet } from '@compass/api-client'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'
import { initials, roleLabel } from '@/lib/roles'
import { CountBadge } from '@/ui/badge'
import { Icon, type IconName } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { Wordmark } from '@/ui/wordmark'
import { useEventStream } from '@/realtime/use-event-stream'
import { useRouteHandle } from '../route-handle'
import { HeaderSlotContext } from './header-slot'

export interface ShellNavItem {
  to: string
  label: string
  icon: IconName
  /** The count right of the label (214 orders, 7 deferrals), when the shell knows it. */
  count?: number
  /** Stay active on child routes too; the default is an exact match. */
  deep?: boolean
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
  /** Unread notifications for the bell's badge (frame 02). */
  notificationCount?: number
}

export function DesktopShell({ navLabel, nav, eyebrow, title, headerStatus, headerLead, notificationCount }: DesktopShellProps) {
  const { t } = useTranslation()
  useEventStream()
  const handle = useRouteHandle()
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)

  return (
    <HeaderSlotContext.Provider value={actionsSlot}>
      <div className="flex min-h-svh bg-background text-foreground">
        <aside className="sticky top-0 flex h-svh w-[232px] shrink-0 flex-col gap-[18px] border-r border-border bg-background py-[18px] pl-3 pr-[13px]">
          <div className="border-b border-border px-2 pb-[15px]">
            <Wordmark />
          </div>
          <nav aria-label={navLabel} className="flex flex-col gap-0.5">
            <p className="m-0 px-2 pb-1.5 font-mono text-[10px] leading-auto tracking-[0.4px] text-slate-400">{navLabel}</p>
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={!item.deep}
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
                    {item.count !== undefined ? (
                      <span className={cn('font-mono text-[11px] leading-auto', isActive ? 'font-semibold text-primary' : 'font-medium text-muted-foreground')}>
                        {item.count}
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
              <p className="type-label m-0 uppercase text-muted-foreground">{handle.eyebrow ?? eyebrow}</p>
              <h1 className="type-page-title m-0 truncate text-foreground">{handle.title ?? title}</h1>
            </div>
            <div className="flex items-center gap-2">
              {headerLead}
              <div ref={setActionsSlot} data-slot="header-actions" className="peer flex items-center gap-2" />
              <div className="px-1 peer-empty:hidden" aria-hidden="true">
                <div className="h-6 w-px bg-slate-200" />
              </div>
              {headerStatus}
              <button
                type="button"
                aria-label={notificationCount ? t('shell.notificationsUnread', { count: notificationCount }) : t('shell.notifications')}
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
    </HeaderSlotContext.Provider>
  )
}

/** The signed-in person at the foot of the sidebar (GET /me). */
function AccountCard() {
  const { t } = useTranslation()
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
        <span className="type-caption text-muted-foreground">{t('shell.notSignedIn')}</span>
      )}
    </div>
  )
}
