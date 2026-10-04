// Figma: L2 Loading list · 185:19377 (tablet 1194 × 834) and L2m-a Runs · 254:1306 (phone 390).
// The dock tablet is shared, so the top bar always says which depot it belongs to and who is
// signed in, and offers Switch user.
import { useMeGet } from '@compass/api-client'
import { DEPOT_NAMES } from '@waypoint/shared/domain'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { useSignOut } from '@/features/identity/sign-out'
import { useSyncEngine } from '@/offline'
import { useEventStream } from '@/realtime/use-event-stream'
import { Avatar } from '@/ui/avatar'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { Wordmark } from '@/ui/wordmark'
import { isDepot } from './depot-context'

/**
 * The loader's shell (L1 to L5 and their phone variants). data-density="touch" raises every
 * control to the 44 px target: the dock is used with gloves on, beside a truck.
 */
export function DockShell() {
  const { t } = useTranslation()
  useEventStream()
  // The tablet queues every tap in Dexie; this is what sends them to POST /sync.
  useSyncEngine()
  const me = useMeGet()
  const signOut = useSignOut('/sign-in/dock')
  const person = me.data?.data
  const depotId = person?.depotId
  const depot = isDepot(depotId) ? DEPOT_NAMES[depotId].toUpperCase() : null

  return (
    <div data-density="touch" className="flex min-h-svh flex-col bg-page text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Wordmark />
          <span className="type-label truncate uppercase text-muted-foreground">{depot ? t('shell.dockOf', { depot }) : t('shell.dock')}</span>
          <span className="type-label hidden uppercase text-muted-foreground sm:inline">{t('shell.sharedTablet')}</span>
        </div>
        <div className="flex items-center gap-3">
          {person ? (
            <>
              <Avatar name={person.name} size={36} />
              <span className="hidden font-sans text-[14px] font-bold text-foreground sm:inline">{person.name}</span>
            </>
          ) : (
            <Skeleton className="size-9 rounded-full" />
          )}
          <Button variant="outline" size="lg" onClick={() => void signOut()}>
            {t('shell.switchUser')}
          </Button>
        </div>
      </header>
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  )
}
