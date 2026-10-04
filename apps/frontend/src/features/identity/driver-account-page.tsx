// Figma: D12 Account · 246:874 and D13 Sign out · 246:1034 (phone 390 × 844)
import { getDeviceId, useMeGet } from '@compass/api-client'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { roleLabel } from '@/lib/roles'
import { useOfflineStatus } from '@/offline/use-offline'
import { Avatar } from '@/ui/avatar'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { Icon } from '@/ui/icon'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from '@/ui/sheet'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { NotificationPreferences } from '@/features/notifications/notification-preferences'
import { useSignOut } from './sign-out'

/**
 * D12: who is signed in on this phone, and the way out. D13's rule is built in: sign out waits
 * until the outbox is empty, so nothing recorded on the road is ever lost, and there is no discard
 * (specs/frontend/screens.md). Notifications opens the person's channel settings in a sheet;
 * language follows when D12 is built against its frame (ROO-62).
 */
export function DriverAccountPage() {
  const { t } = useTranslation()
  const me = useMeGet()
  const { online, pending } = useOfflineStatus()
  const signOut = useSignOut('/sign-in/driver')
  // True from the tap until the session is gone; while records are queued it is the wait itself.
  const [waiting, setWaiting] = useState(false)
  const person = me.data?.data

  const leave = useCallback(async () => {
    try {
      await signOut()
    } finally {
      setWaiting(false)
    }
  }, [signOut])

  // Asked to sign out: go as soon as the outbox is empty, which may be at once or after a sync.
  useEffect(() => {
    if (waiting && pending === 0) void leave()
  }, [waiting, pending, leave])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="type-page-title m-0 text-foreground">{t('account.title')}</h1>

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          {person ? <Avatar name={person.name} size={44} /> : <Skeleton className="size-11 rounded-full" />}
          <div className="flex min-w-0 flex-col gap-0.5">
            {person ? (
              <>
                <span className="truncate font-sans text-[16px] font-bold text-foreground">{person.name}</span>
                <span className="type-caption text-muted-foreground">{roleLabel(person.role)}</span>
              </>
            ) : (
              <>
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-16" />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <Row label={t('account.phone')} value={person?.phoneNumber ?? '—'} />
          <Row label={t('account.vehicle')} value={person?.vehicleId ?? '—'} />
          <Row label={t('account.depot')} value={person?.depotId ?? '—'} />
          <Row label={t('account.device')} value={getDeviceId().slice(0, 8)} mono />
        </CardContent>
      </Card>

      <section aria-label="Help and settings" className="flex flex-col gap-2">
        <p className="type-label m-0 uppercase text-muted-foreground">Help &amp; settings</p>
        <Card>
          <CardContent className="p-0">
            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-4 text-left outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className="font-sans text-[15px] font-medium text-foreground">Notifications</span>
                  <Icon name="chevron-right" size={16} className="text-muted-foreground" />
                </button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader title="Notifications" description="Choose how each kind of notification reaches you." />
                <SheetBody className="overflow-y-auto">
                  <NotificationPreferences touch />
                </SheetBody>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-sans text-[15px] font-bold text-foreground">{t('account.signOut')}</span>
            <StatusChip tone={pending === 0 ? 'success' : online ? 'warning' : 'danger'}>
              {pending === 0 ? t('account.allSynced') : t('account.pending', { count: pending })}
            </StatusChip>
          </div>
          <p className="type-body m-0 text-muted-foreground">
            {pending === 0
              ? t('account.signOutBody')
              : online
                ? t('account.waiting', { count: pending })
                : t('account.offlineWaiting', { count: pending })}
          </p>
          <Button variant="outline" size="lg" className="h-[52px] w-full" loading={waiting} onClick={() => setWaiting(true)}>
            {t('account.signOut')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="type-label uppercase text-muted-foreground">{label}</span>
      <span className={mono ? 'type-mono-small text-foreground' : 'type-body text-foreground'}>{value}</span>
    </div>
  )
}
