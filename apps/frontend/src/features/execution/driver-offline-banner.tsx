// Figma: D6 Offline · 185:20316 (phone 390 × 844). Built from the frame's description without
// Figma access; see docs/departures.md.
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatColombo } from '@/lib/format-colombo'
import { useOfflineStatus } from '@/offline'
import { Icon } from '@/ui/icon'

/**
 * D6: the driver's phone says what is still true when the signal goes. Taps keep working and are
 * kept in the outbox, so the banner is a warning, not an error: it counts the records waiting and
 * says when the last batch got through. A 401 is the other way sync stops, and it reads
 * "Sign in to send 3 records" with a way back in; the records stay on the phone either way
 * (specs/sync/spec.md, Offline and signed out). Online and signed in, there is nothing to show.
 */
export function DriverOfflineBanner() {
  const { t } = useTranslation()
  const { online, pending, paused, lastSyncAt } = useOfflineStatus()
  const signedOut = paused && pending > 0
  if (online && !signedOut) return null

  const lastSent = lastSyncAt
    ? t('driver.lastSent', { time: formatColombo(lastSyncAt, 'HH:mm') })
    : t('driver.neverSent')

  return (
    <div
      role="status"
      data-slot="driver-offline-banner"
      className="flex items-start gap-3 rounded-lg border border-status-warning-border bg-status-warning-bg px-[17px] py-[13px]"
    >
      <Icon name="wifi-off" size={18} className="mt-0.5 shrink-0 text-status-warning-fg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="type-body-strong m-0 text-status-warning-fg">
          {signedOut
            ? t('driver.signInToSend', { count: pending })
            : pending > 0
              ? t('driver.offline', { count: pending })
              : t('driver.offlineNothingPending')}
        </p>
        <p className="type-caption m-0 text-status-warning-fg">
          {signedOut ? t('driver.signInToSendBody') : t('driver.offlineSafe')} {lastSent}
        </p>
        {signedOut ? (
          <Link to="/sign-in/driver" className="type-body-strong text-primary">
            {t('driver.signInAction')}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
