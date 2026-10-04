// Figma: D1 Today's trip · 185:19938 (phone 390 × 844). The driver works one-handed in a cab, so
// the shell is a top bar, the screen, and three tabs along the bottom.
import { useMeGet } from '@compass/api-client'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'
import { useRouteHandle } from '../route-handle'
import { useSyncEngine } from '@/offline'
import { DriverOfflineBanner } from '@/features/execution/driver-offline-banner'
import { useTripTracking } from '@/features/execution/position-sender'
import { useEventStream } from '@/realtime/use-event-stream'
import { useSyncEngine } from '@/offline/use-sync-engine'
import { Avatar } from '@/ui/avatar'
import { Icon, type IconName } from '@/ui/icon'
import { Skeleton } from '@/ui/skeleton'
import { Wordmark } from '@/ui/wordmark'

const TABS: readonly { to: string; labelKey: string; icon: IconName; deep?: boolean }[] = [
  { to: '/driver', labelKey: 'nav.today', icon: 'today' },
  { to: '/driver/trips', labelKey: 'nav.trips', icon: 'trips', deep: true },
  { to: '/driver/account', labelKey: 'nav.account', icon: 'account' },
]

/**
 * The driver's shell (D1 to D14). data-density="touch" raises every control to the 44 px target;
 * each tab is its own 44 px target too.
 */
export function DriverShell() {
  const { t } = useTranslation()
  // Home-level screens carry the tab bar; a live trip (D3 to D7) hides it so the next tap is the
  // one the stop needs (the Figma component's own note).
  const { tabBar = true } = useRouteHandle()
  useEventStream()
  // The phone queues every tap in Dexie; this is what sends them to POST /sync.
  useSyncEngine()
  // The phone reports where it is only while a trip is IN_PROGRESS (ROO-37).
  useTripTracking()
  const me = useMeGet()
  const person = me.data?.data
  // The outbox leaves on its own; a 401 pauses it until this person is signed in again (D6).
  useSyncEngine(Boolean(person))

  return (
    <div data-density="touch" className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Wordmark />
          <span className="type-label uppercase text-muted-foreground">{t('shell.driver')}</span>
        </div>
        {person ? <Avatar name={person.name} size={36} /> : <Skeleton className="size-9 rounded-full" />}
      </header>
      {/* D6: no signal, or records still on their way, on every driver screen. */}
      <DriverOfflineBanner />

      <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4">
        <DriverOfflineBanner />
        <Outlet />
      </main>

      {tabBar ? (
      <nav aria-label={t('shell.driver')} className="sticky bottom-0 flex border-t border-border bg-background">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={!tab.deep}
            className={({ isActive }) =>
              cn(
                'flex min-h-(--compass-size-touch-target) flex-1 flex-col items-center justify-center gap-1 py-2 no-underline transition-colors duration-100',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon name={tab.icon} size={22} />
                <span className={cn('font-sans text-[12px] leading-auto', isActive ? 'font-bold' : 'font-medium')}>{t(tab.labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      ) : null}
    </div>
  )
}
