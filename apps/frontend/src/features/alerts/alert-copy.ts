import type { AlertDto, AlertDtoType } from '@compass/api-client'
import type { StatusTone } from '@/ui/status-chip'

/**
 * The words and tones the three alert panels share. Copy comes from the
 * frames: 01's "Needs Attention" list and 19's alerts column both lead with
 * the alert's kind, so these labels match the Figma strings exactly.
 */
export const ALERT_TYPE_LABELS: Record<AlertDtoType, string> = {
  LATE_RISK: 'Late risk',
  FAILED_STOP: 'Failed stop',
  LOADER_SHORTFALL: 'Loader shortfall',
  STORE_ISSUE: 'Store issue',
  DRIVER_CANT_RUN: "Driver can't run",
  VEHICLE_OFFLINE: 'Vehicle offline',
  PRIORITY_REQUEST: 'Priority request',
  SYNC_CONFLICT: 'Sync conflict',
}

export const ALERT_TYPE_OPTIONS = Object.entries(ALERT_TYPE_LABELS) as [AlertDtoType, string][]

/**
 * The dot beside an alert. A resolved alert is green whatever it was raised
 * at — 19 keeps "VAN-03 back online" in the column for a while so the
 * dispatcher can see the problem went away.
 *
 * The frames draw some severity-2 alerts red and others grey; this maps the
 * tone to the severity the server sends instead, so the colour and the word
 * beside it can never disagree. Severity always appears as a word as well
 * (specs/alerts/spec.md, Non-functional: status is never colour alone).
 */
export function alertTone(alert: Pick<AlertDto, 'severity' | 'status'>): StatusTone {
  if (alert.status === 'RESOLVED') return 'success'
  if (alert.severity === 1) return 'danger'
  return alert.severity === 2 ? 'at-risk' : 'muted'
}

const DOT_CLASSES: Record<StatusTone, string> = {
  danger: 'bg-status-danger-icon',
  'at-risk': 'bg-status-at-risk-icon',
  warning: 'bg-status-warning-icon',
  success: 'bg-status-success-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
  muted: 'bg-slate-400',
}

export const alertDotClass = (tone: StatusTone): string => DOT_CLASSES[tone]

/**
 * How long the alert has been open, as 01 and 19 show it in the corner of
 * each row: "2m", "9m", "14m", then hours and days. A resolved alert counts
 * to the moment it closed, not to now.
 */
export function alertAge(alert: Pick<AlertDto, 'raisedAt' | 'resolvedAt'>, now: Date): string {
  const until = alert.resolvedAt ? Date.parse(alert.resolvedAt) : now.getTime()
  const minutes = Math.max(0, Math.round((until - Date.parse(alert.raisedAt)) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

/** The alert's heading: "Late risk · REF-07 Trip 1" where there is a reference. */
export function alertHeading(alert: AlertDto, reference?: string | null): string {
  const kind = ALERT_TYPE_LABELS[alert.type]
  return reference ? `${kind} · ${reference}` : kind
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The second line: the server's own sentence, plus the one or two numbers
 * from `detail` that the frames show beside it ("25 min behind plan",
 * "Last seen 07:02"). Anything the payload does not carry is simply left out
 * rather than guessed at.
 */
export function alertDetailLine(alert: AlertDto): string {
  const detail = isRecord(alert.detail) ? alert.detail : {}
  const extras: string[] = []

  const minutesLate = detail.minutesLate
  if (typeof minutesLate === 'number' && minutesLate > 0) extras.push(`${Math.round(minutesLate)} min past the window`)

  const minutesSilent = detail.minutesSilent
  if (typeof minutesSilent === 'number') extras.push(`${Math.round(minutesSilent)} min without a signal`)

  const minutesToDeparture = detail.minutesToDeparture
  if (typeof minutesToDeparture === 'number') {
    extras.push(minutesToDeparture >= 0 ? `leaves in ${minutesToDeparture} min` : `${Math.abs(minutesToDeparture)} min past departure`)
  }

  const reason = detail.reason ?? detail.issueType ?? detail.outcome
  if (typeof reason === 'string') extras.push(reason.toLowerCase().replaceAll('_', ' '))

  return extras.length > 0 ? `${alert.title} · ${extras.join(' · ')}` : alert.title
}
