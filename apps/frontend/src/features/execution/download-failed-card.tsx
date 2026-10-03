// Figma: D2 Download failed · 185:20021 (the failed-download state of D1)
import { useTranslation } from 'react-i18next'
import { formatColombo } from '@/lib/format-colombo'
import { Button } from '@/ui/button'

export interface DownloadFailedCardProps {
  /** When this phone last saved a bundle; the driver needs to know what she is carrying. */
  lastBundleAt: Date | null
  onRetry: () => void
}

/**
 * D1's failure state. It replaces "Saved for offline" and says the one thing that matters in the
 * yard: this phone does not hold the whole trip, so fix it before the gate (AC-EXE-05).
 *
 * It never clears what is already saved. A driver with yesterday's bundle and no signal is better
 * off than a driver with nothing, so the retry is an offer, not a condition.
 */
export function DownloadFailedCard({ lastBundleAt, onRetry }: DownloadFailedCardProps) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex w-full items-center gap-3 rounded-lg border border-status-danger-border bg-status-danger-bg px-[17px] py-[13px]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="type-body-strong m-0 text-destructive-foreground">{t('driver.downloadBeforeLeaving')}</p>
        <p className="type-body m-0 text-slate-700">{t('driver.downloadBeforeLeavingBody')}</p>
        {lastBundleAt ? (
          <p className="type-caption m-0 pt-0.5 text-muted-foreground">
            {t('driver.lastSaved', { time: formatColombo(lastBundleAt, 'HH:mm') })}
          </p>
        ) : null}
      </div>
      <Button variant="outline" onClick={onRetry}>
        {t('driver.retry')}
      </Button>
    </div>
  )
}
