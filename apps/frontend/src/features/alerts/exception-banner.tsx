// Figma: 01 Dashboard · 488:8577 (the red banner above the KPI row, with Re-sequence and Resolve)
import { useServerClock } from '@/lib/server-clock'
import { AlertActions } from './alert-actions'
import { alertDetailLine, alertHeading, alertTone } from './alert-copy'
import { useDepotAlerts } from './use-depot-alerts'

export interface ExceptionBannerProps {
  depotId: string
}

/**
 * The one alert at the top of 01: the worst thing happening in the depot right
 * now, with its fix beside it.
 *
 * It shows the first alert of the list the server already ordered, so "worst"
 * means exactly what it means in the panel below and on 19 — there is no
 * second opinion about priority anywhere in the app.
 *
 * Nothing renders when the depot is calm. A banner that is always there stops
 * being read, and an empty red strip would say there is a problem when there
 * is not.
 */
export function ExceptionBanner({ depotId }: ExceptionBannerProps) {
  const { now } = useServerClock(30_000)
  const { open, isPending, isError } = useDepotAlerts({ depotId, status: 'OPEN,ACKNOWLEDGED', limit: 1 })

  // A failed load is reported by the panel below, which owns the error state;
  // two error boxes for one failed request would be noise.
  if (isPending || isError) return null
  const [worst] = open
  if (!worst) return null

  return (
    <section
      role="status"
      data-slot="exception-banner"
      data-tone={alertTone(worst)}
      className="flex items-center justify-between gap-4 rounded-lg border border-status-danger-border bg-status-danger-bg px-[17px] py-[13px]"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="type-body-strong m-0 text-destructive-foreground">{alertHeading(worst)}</p>
        <p className="type-body m-0 text-slate-700">{alertDetailLine(worst)}</p>
        <p className="type-label m-0 pt-0.5 uppercase text-muted-foreground">
          {worst.severityLabel} · raised {new Date(worst.raisedAt) <= now ? alertAgeLabel(worst.raisedAt, now) : 'just now'}
        </p>
      </div>
      <AlertActions alert={worst} emphasis="resolve" />
    </section>
  )
}

const alertAgeLabel = (raisedAt: string, now: Date): string => {
  const minutes = Math.round((now.getTime() - Date.parse(raisedAt)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}
