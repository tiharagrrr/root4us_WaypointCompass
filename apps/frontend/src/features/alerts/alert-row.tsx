// Figma: 01 Dashboard · 488:8577 ("Needs Attention" rows) and 19 Tracking · 185:17224 (the
// alerts column's compact rows)
import type { AlertDto } from '@compass/api-client'
import { cn } from '@/lib/cn'
import { alertAge, alertDetailLine, alertDotClass, alertHeading, alertTone } from './alert-copy'

export interface AlertRowProps {
  alert: AlertDto
  now: Date
  /** The thing it is about, when the screen knows it ("REF-07 Trip 1"). */
  reference?: string | null
  /** 19's column opens the row it is showing in full. */
  selected?: boolean
  onSelect?: (alert: AlertDto) => void
}

/**
 * One alert in a list: a severity dot, what is wrong, the specifics, and how
 * long it has been there.
 *
 * The severity is a word as well as a colour, because a dispatcher reading
 * the panel in a bright depot office, or anyone who does not separate red
 * from grey, still has to be able to tell a critical alert from an
 * informational one (specs/alerts/spec.md, Non-functional).
 */
export function AlertRow({ alert, now, reference, selected = false, onSelect }: AlertRowProps) {
  const tone = alertTone(alert)
  const body = (
    <>
      <span aria-hidden className={cn('mt-[7px] size-2 shrink-0 rounded-full', alertDotClass(tone))} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-body-strong text-foreground">{alertHeading(alert, reference)}</span>
        <span className="type-body text-slate-700">{alertDetailLine(alert)}</span>
        <span className="type-label uppercase text-muted-foreground">
          {alert.status === 'RESOLVED' ? 'Resolved' : alert.severityLabel}
          {alert.status === 'ACKNOWLEDGED' ? ' · someone is on it' : ''}
        </span>
      </span>
      <span className="type-caption shrink-0 pt-px text-muted-foreground">{alertAge(alert, now)}</span>
    </>
  )

  if (!onSelect) {
    return (
      <li data-slot="alert-row" data-tone={tone} className="flex items-start gap-2.5 px-4 py-3">
        {body}
      </li>
    )
  }

  return (
    <li data-slot="alert-row" data-tone={tone}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(alert)}
        className={cn(
          'flex w-full cursor-pointer items-start gap-2.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50',
          selected && 'bg-slate-50',
        )}
      >
        {body}
      </button>
    </li>
  )
}
