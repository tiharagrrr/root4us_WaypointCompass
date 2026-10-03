// Figma: L2 Loading list · 185:19377 (no offline frame was drawn; see docs/departures.md)
import { useTranslation } from 'react-i18next'
import { useOfflineStatus } from '@/offline'
import { Icon } from '@/ui/icon'

/**
 * The dock's wifi drops behind a parked reefer, so the banner says what is still true: the ticks
 * are on the tablet and will go when there is signal. It is not an error — nothing has been lost —
 * so it is drawn in the warning tone rather than the danger one.
 */
export function DockOfflineBanner() {
  const { t } = useTranslation()
  const { online, pending } = useOfflineStatus()
  if (online) return null

  return (
    <div role="status" data-slot="dock-offline-banner" className="flex items-center gap-3 rounded-lg border border-status-warning-border bg-status-warning-bg px-[17px] py-[13px]">
      <Icon name="wifi-off" size={18} className="text-status-warning-fg" />
      <p className="type-body-strong m-0 flex-1 text-status-warning-fg">
        {pending > 0 ? t('loading.offlineWithPending', { count: pending }) : t('loading.offline')}
      </p>
    </div>
  )
}
