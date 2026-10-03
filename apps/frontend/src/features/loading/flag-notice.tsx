// Figma: L3a Item flagged · 549:2497, L3b Dispatcher replied · 542:2659 and L3c Item re-checked ·
// 542:2821 (the banner above the list), with L3m-a Item flagged · 549:3616 for the phone's shorter
// wording
import type { LoadFlagDto } from '@compass/api-client'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { formatColombo } from '@/lib/format-colombo'
import { enqueue } from '@/offline'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { flagReasonLabel } from './loading-copy'
import type { LoadLineView } from './use-load-list'

export interface FlagNoticeProps {
  tripId: string
  flag: LoadFlagDto
  line: LoadLineView | undefined
  /** Asks for the checker's name, then re-checks the replacement (L3b). */
  onRecheck: (flag: LoadFlagDto, line: LoadLineView | undefined) => void
  /** Clears the "it cleared" notice (L3c); the red and amber ones go when the flag does. */
  onAcknowledge: () => void
}

/**
 * The one thing the dock is waiting on, across the top of L2.
 *
 * L3a is red and waiting on the dispatcher, with Undo until they reply; L3b is amber and waiting
 * on the loader, with the dispatcher's own words and the re-check that clears it. Which one shows
 * is the flag's status, and which button shows is the server's links — the dispatcher's reply takes
 * the undo away by itself (AC-LOD-09, AC-LOD-10).
 */
export function FlagNotice({ tripId, flag, line, onRecheck, onAcknowledge }: FlagNoticeProps) {
  const { t } = useTranslation()
  const item = line?.itemName ?? line?.sku ?? t('loading.flagged.theItem')
  const cleared = flag.status === 'RESOLVED'
  const replied = !cleared && (flag.status === 'AWAITING_RECHECK' || Boolean(flag.decision))

  return (
    <div
      role="status"
      data-slot="flag-notice"
      data-state={flag.status}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-[17px] py-[13px]',
        cleared
          ? 'border-status-success-border bg-status-success-bg'
          : replied
            ? 'border-status-warning-border bg-status-warning-bg'
            : 'border-status-danger-border bg-status-danger-bg',
      )}
    >
      <p
        className={cn(
          'type-body-strong m-0 flex-1',
          cleared ? 'text-status-success-fg' : replied ? 'text-status-warning-fg' : 'text-status-danger-fg',
        )}
      >
        {cleared
          ? t('loading.cleared.banner', { time: flag.resolvedAt ? formatColombo(flag.resolvedAt, 'HH:mm') : '—' })
          : replied
          ? t('loading.decided.banner', {
              time: flag.decidedAt ? formatColombo(flag.decidedAt, 'HH:mm') : '—',
              decision: flag.decision === 'REMOVE' ? t('loading.decided.remove') : t('loading.decided.replace'),
              note: flag.decisionNote ?? t('loading.decided.noNote'),
            })
          : t('loading.flagged.banner', {
              item,
              qty: flag.qtyAffected,
              seq: line?.stopSeq ?? '—',
              reason: flagReasonLabel(flag.reason).toLowerCase(),
              time: flag.raisedAt ? formatColombo(flag.raisedAt, 'HH:mm') : '—',
            })}
      </p>
      <Action
        link={flag._links.undo}
        variant="outline"
        size="lg"
        onAction={() => enqueue({ kind: 'loader', type: 'LOAD_FLAG_UNDONE', tripId, loadFlagId: flag.id })}
      >
        {t('loading.flagged.undo')}
      </Action>
      <Action link={flag._links.recheck} variant="outline" size="lg" onAction={() => onRecheck(flag, line)}>
        {t('loading.decided.recheck')}
      </Action>
      {cleared ? (
        <Button variant="outline" size="lg" onClick={onAcknowledge}>
          {t('loading.gotIt')}
        </Button>
      ) : null}
    </div>
  )
}
