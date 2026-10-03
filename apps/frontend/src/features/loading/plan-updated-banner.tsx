// Figma: L2 Loading list · 185:19377 (the blue notice above the list, with Got it)
import { useTranslation } from 'react-i18next'
import { formatColombo } from '@/lib/format-colombo'
import { Button } from '@/ui/button'

export interface PlanUpdatedBannerProps {
  at: Date
  onAcknowledge: () => void
}

/**
 * "Plan updated at 04:52. The old loading list has been replaced."
 *
 * The list under it is read-only while it shows, because a pallet half-built against a list that
 * no longer exists is worse than an interruption: the next tick would go against a line the plan
 * has already moved (AC-LOD-13).
 */
export function PlanUpdatedBanner({ at, onAcknowledge }: PlanUpdatedBannerProps) {
  const { t } = useTranslation()
  return (
    <div role="status" data-slot="plan-updated-banner" className="flex items-center gap-3 rounded-lg border border-blue-200 bg-accent px-[17px] py-[13px]">
      <p className="type-body-strong m-0 flex-1 text-primary">{t('loading.planUpdated', { time: formatColombo(at, 'HH:mm') })}</p>
      <Button variant="outline" size="lg" onClick={onAcknowledge}>
        {t('loading.gotIt')}
      </Button>
    </div>
  )
}
