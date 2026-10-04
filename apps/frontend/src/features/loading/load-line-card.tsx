// Figma: L2 Loading list · 185:19377 (Card / Fresh milk 1 L) and L3a Item flagged · 549:2497
// (Card / Eggs tray 30, the flagged state of the same card)
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { getLink } from '@/lib/links'
import { Icon } from '@/ui/icon'
import { StatusChip } from '@/ui/status-chip'
import { flagReasonLabel, isSettled, latestFlag, liveFlag } from './loading-copy'
import type { LoadLineView } from './use-load-list'

export interface LoadLineCardProps {
  line: LoadLineView
  /** The whole list is frozen while the Plan updated banner is up (AC-LOD-13). */
  frozen?: boolean
  onCheck: (line: LoadLineView) => void
  onUndo: (line: LoadLineView) => void
  /** Drawn under the card: L3b puts the dispatcher's decision here. */
  footer?: ReactNode
}

/**
 * One line of the load list. The tick is the whole interaction: pressing it says "all of these are
 * on the pallet" and pressing it again takes that back, both through the outbox so the dock keeps
 * working with no signal (architecture rule 10).
 *
 * Loading fewer than expected is never a quieter number — it is a flag for the dispatcher — so the
 * card has no quantity field (AC-LOD-05). A flagged line turns red and stops being tickable until
 * the dispatcher has decided what happens to it.
 */
export function LoadLineCard({ line, frozen = false, onCheck, onUndo, footer }: LoadLineCardProps) {
  const { t } = useTranslation()
  const checked = isSettled(line.status)
  const flag = liveFlag(line.flags)
  // A line the dock put right keeps its green until the list is reloaded: "it is dealt with" is
  // worth saying out loud on a pallet somebody else may be standing at (L3c).
  const resolved = !flag && Boolean(latestFlag(line.flags)) && line.status === 'REPLACED'
  // Amber once the dispatcher has replied and the dock owes a re-check; red while they have not.
  const awaiting = flag?.status === 'AWAITING_RECHECK' || Boolean(flag?.decision)
  const flagged = line.status === 'FLAGGED' || Boolean(flag)
  const name = line.itemName ?? line.sku ?? line.orderNo
  // The server says which of the two this line will take; without either, the list is read-only
  // (a released trip carries neither, AC-LOD-06).
  const canCheck = Boolean(getLink(line._links, 'check'))
  const canUndo = Boolean(getLink(line._links, 'undo'))
  const actionable = (checked ? canUndo || line.queued : canCheck) && !frozen

  return (
    <li data-slot="load-line" data-status={line.status} className="list-none pb-1.5">
      <div
        className={cn(
          'relative flex min-h-[58px] items-center gap-[14px] overflow-hidden rounded-lg border px-[15px] py-1',
          resolved
            ? 'border-status-success-border bg-status-success-bg'
            : flagged
            ? awaiting
              ? 'border-status-warning-border bg-status-warning-bg'
              : 'border-status-danger-border bg-status-danger-bg'
            : checked
              ? 'border-slate-200 bg-page'
              : 'border-slate-300 bg-background',
        )}
      >
        {resolved ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[5px] bg-status-success-icon" /> : null}
        {flagged ? (
          <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[5px]', awaiting ? 'bg-status-warning-icon' : 'bg-status-danger-icon')} />
        ) : null}
        {resolved ? (
          <span aria-hidden="true" className="flex size-[26px] shrink-0 items-center justify-center rounded-sm border border-status-success-icon bg-status-success-icon text-background">
            <Icon name="check" size={16} />
          </span>
        ) : flagged ? (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-[26px] shrink-0 items-center justify-center rounded-sm border text-background',
              awaiting ? 'border-status-warning-icon bg-status-warning-icon' : 'border-status-danger-icon bg-status-danger-icon',
            )}
          >
            <Icon name={awaiting ? 'redo' : 'flag'} size={16} />
          </span>
        ) : (
          <button
            type="button"
            disabled={!actionable}
            aria-pressed={checked}
            aria-label={checked ? t('loading.undoCheckOf', { item: name }) : t('loading.tick', { item: name })}
            onClick={() => (checked ? onUndo(line) : onCheck(line))}
            className={cn(
              'flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-sm border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40',
              checked ? 'border-slate-900 bg-slate-900 text-background hover:bg-slate-800' : 'border-input bg-background text-transparent',
            )}
          >
            <Icon name="check" size={21} />
          </button>
        )}
        <p
          className={cn(
            'm-0 min-w-px flex-1 font-sans text-[15px] font-medium',
            resolved
              ? 'text-status-success-fg'
              : flagged
                ? awaiting
                  ? 'text-status-warning-fg'
                  : 'text-status-danger-fg'
                : checked
                  ? 'text-muted-foreground'
                  : 'text-foreground',
          )}
        >
          {name}
          {checked && line.checkedByName ? (
            <span className="type-body-small block font-normal text-muted-foreground">{t('loading.checkedByLine', { name: line.checkedByName })}</span>
          ) : null}
        </p>
        {flag ? (
          awaiting ? (
            <StatusChip tone="warning">
              {t('loading.decided.chip', { decision: (flag.decision ?? 'REPLACE').toUpperCase() })}
            </StatusChip>
          ) : (
            <StatusChip tone="danger">{t('loading.flagged.chip', { reason: flagReasonLabel(flag.reason).toUpperCase() })}</StatusChip>
          )
        ) : null}
        {line.packLabel ? <StatusChip tone="muted">{line.packLabel}</StatusChip> : null}
        {line.queued ? <StatusChip tone="info">{t('loading.queued')}</StatusChip> : null}
        {line.status === 'REMOVED' ? <StatusChip tone="danger">{t('loading.removed')}</StatusChip> : null}
        {line.status === 'REPLACED' ? <StatusChip tone="success">{t('loading.replaced')}</StatusChip> : null}
        <p className="type-data-bold m-0 text-[15px] text-foreground">×{line.qtyExpected}</p>
      </div>
      {footer}
    </li>
  )
}
