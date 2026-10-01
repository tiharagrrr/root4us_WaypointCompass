// Figma: M1 New order · 185:10376 (the store chrome: sidebar, account card and header)
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'
import { CountBadge } from '@/ui/badge'
import { Icon, type IconName } from '@/ui/icon'
import { AccountMenu } from '@/features/identity/account-menu'
import { Wordmark } from '@/ui/wordmark'
import { useRouteHandle } from '../route-handle'
import { StoreHeaderSlotContext } from './store-header-slot'

export type StoreSection = 'orders/new' | 'orders' | 'deferrals' | 'receipts' | 'catalog'

const NAV: readonly { section: StoreSection; label: string; icon: IconName }[] = [
  { section: 'orders/new', label: 'New order', icon: 'new-order' },
  { section: 'orders', label: 'Orders', icon: 'orders' },
  { section: 'deferrals', label: 'Deferrals', icon: 'deferrals' },
  { section: 'receipts', label: 'Receipts', icon: 'receipts' },
  { section: 'catalog', label: 'Item catalog', icon: 'item-catalog' },
]

export interface StoreLayoutProps {
  /** The outlet this terminal stands in, as the nav label and the header eyebrow name it. */
  outletName?: string
  /** Counts beside the nav items (3 orders, 1 deferral, ...), when known. */
  navCounts?: Partial<Record<StoreSection, number>>
  /** Unread notifications for the bell's badge. */
  notificationCount?: number
  /** Header slot right of the screen's actions, for the demo-time badge. */
  headerStatus?: ReactNode
}

/**
 * The store manager's desktop shell (1440 x 960): the five store screens sit in the Outlet.
 * "New order" is an exact path so it does not stay active while /store/orders is open.
 */
export function StoreLayout({ outletName, navCounts = {}, notificationCount, headerStatus }: StoreLayoutProps) {
  const { title } = useRouteHandle()
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
  const place = outletName ?? 'Fresh Kadawatha'

  return (
    <StoreHeaderSlotContext.Provider value={actionsSlot}>
      <div className="flex min-h-svh bg-background text-foreground">
        <aside className="sticky top-0 flex h-svh w-[232px] shrink-0 flex-col gap-[18px] border-r border-border bg-background py-[18px] pl-3 pr-[13px]">
          <div className="border-b border-border px-2 pb-[15px]">
            <Wordmark />
          </div>
          <nav aria-label="Store" className="flex flex-col gap-0.5">
            <p className="m-0 px-2 pb-1.5 font-mono text-[10px] leading-auto tracking-[0.4px] uppercase text-slate-400">
              Store · {place}
            </p>
            {NAV.map((item) => (
              <NavLink
                key={item.section}
                to={`/store/${item.section}`}
                end={item.section === 'orders/new' || item.section === 'orders'}
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
              <p className="type-label m-0 uppercase text-muted-foreground">
                {title ?? 'Store'} · {place} · outlet counter
              </p>
              <h1 className="type-page-title m-0 truncate text-foreground">{title ?? 'Store'}</h1>
            </div>
            <div className="flex items-center gap-2">
              <div ref={setActionsSlot} data-slot="store-header-actions" className="peer flex items-center gap-2" />
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
          <main className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-4">
            <Outlet />
          </main>
        </div>
      </div>
    </StoreHeaderSlotContext.Provider>
  )
}
