// Figma: D6 Offline · 185:20316
import { useTranslation } from 'react-i18next'
import { formatColombo } from '@/lib/format-colombo'
import { useOfflineStatus } from '@/offline'
import { Icon } from '@/ui/icon'

/**
 * D6 on every driver screen: with no signal the phone keeps working from the saved trip, and the
 * band says so, with how many records are waiting. Once signal is back and the queue is still
 * draining, a quieter line says they are on their way. Nothing shows when online with nothing
 * waiting.
 */
export function DriverOfflineBanner() {
  const { t } = useTranslation()
  const { online, pending, lastSyncAt } = useOfflineStatus()

  if (!online)
    return (
      <div
        role="status"
        data-slot="driver-offline-banner"
        className="flex flex-col gap-0.5 border-b border-status-danger-border bg-status-danger-bg px-4 py-2.5"
      >
        <p className="type-body-strong m-0 flex items-center gap-2 text-status-danger-fg">
          <Icon name="wifi-off" size={16} />
          {t('driver.offlineTitle')}
        </p>
        <p className="type-body m-0 text-slate-700">
          {pending > 0 ? t('driver.offlinePending', { count: pending }) : t('driver.offlineNothingPending')}
          {lastSyncAt ? ` · ${t('driver.lastSynced', { time: formatColombo(lastSyncAt, 'HH:mm') })}` : ''}
        </p>
      </div>
    )

  if (pending > 0)
    return (
      <div role="status" data-slot="driver-sending-banner" className="border-b border-border bg-slate-50 px-4 py-2">
        <p className="type-body m-0 text-slate-700">{t('driver.sending', { count: pending })}</p>
      </div>
    )

  return null
}
