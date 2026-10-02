// Figma: 19 Tracking · 185:17224 (the open alert at the top of the alerts column)
import type { AlertDto } from '@compass/api-client'
import { cn } from '@/lib/cn'
import { alertAge, alertDetailLine, alertHeading, alertTone } from './alert-copy'
import { AlertActions } from './alert-actions'

const TONE_SURFACE: Record<string, string> = {
  danger: 'border-status-danger-border bg-status-danger-bg',
  'at-risk': 'border-status-at-risk-border bg-status-warning-bg',
  success: 'border-status-success-border bg-status-success-bg',
  muted: 'border-border bg-page',
  neutral: 'border-border bg-page',
  info: 'border-status-info-border bg-status-info-bg',
  warning: 'border-status-warning-border bg-status-warning-bg',
}

const TONE_HEADING: Record<string, string> = {
  danger: 'text-destructive-foreground',
  'at-risk': 'text-status-at-risk-fg',
  success: 'text-status-success-fg',
  muted: 'text-foreground',
  neutral: 'text-foreground',
  info: 'text-status-info-fg',
  warning: 'text-status-warning-fg',
}

export interface AlertDetailCardProps {
  alert: AlertDto
  now: Date
  reference?: string | null
  /** Told when the viewer acts, so the list can keep this alert in view. */
  onAct?: (alert: AlertDto) => void
  className?: string
}

/**
 * The alert the dispatcher is looking at, opened in full: what is wrong, the
 * specifics, every fix they may take, and a line saying what will close it on
 * its own if they do nothing.
 *
 * That last line matters more than it looks. Alerts close themselves when the
 * fix happens, so the dispatcher should rarely need "Resolve"; saying so is
 * what stops the panel turning into a list of things to tick off.
 */
export function AlertDetailCard({ alert, now, reference, onAct, className }: AlertDetailCardProps) {
  const tone = alertTone(alert)
  return (
    <article
      data-slot="alert-detail-card"
      data-tone={tone}
      className={cn('flex flex-col gap-2 rounded-md border p-[13px]', TONE_SURFACE[tone], className)}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className={cn('type-body-strong m-0', TONE_HEADING[tone])}>{alertHeading(alert, reference)}</h3>
        <span className="type-caption shrink-0 pt-px text-muted-foreground">{alertAge(alert, now)}</span>
      </header>

      <p className="type-body m-0 text-slate-700">{alertDetailLine(alert)}</p>

      <p className="type-label m-0 uppercase text-muted-foreground">
        {alert.status === 'RESOLVED' ? 'Resolved' : alert.severityLabel}
        {alert.acknowledgedById && alert.status !== 'RESOLVED' ? ' · someone is on it' : ''}
      </p>

      <AlertActions alert={alert} onAct={onAct} />

      <p className="type-caption m-0 text-muted-foreground">
        {alert.status === 'RESOLVED'
          ? (alert.resolution ?? 'Closed when the fix happened.')
          : `Closes itself when ${alert.resolvesWhen}.`}
      </p>
    </article>
  )
}
