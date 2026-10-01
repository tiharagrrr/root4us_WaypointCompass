// Figma: M1 New order · 185:10376 ("Card / Cutoff 4:00 PM") and M2 Cutoff passed · 185:10649
import type { OrderDto } from '@compass/api-client'
import { clockLabel, countdownLabel, dayLabel, timeLabel } from './order-format'

export interface CutoffCardProps {
  order: OrderDto
  /** Server time, from useServerClock(): the countdown and M2's "It is 16:12" both read it. */
  now: Date
}

/**
 * The cutoff, in the order's summary card. Before it, M1 counts down to it. Once the server has
 * rolled the order to the following run, M2's notice takes the slot and names the new run.
 */
export function CutoffCard({ order, now }: CutoffCardProps) {
  const left = countdownLabel(order.editableUntil, now)

  if (order.afterCutoff || left === null) {
    return (
      <div
        role="status"
        data-slot="cutoff-passed"
        className="flex items-center gap-3 rounded-lg border border-status-danger-border bg-status-danger-bg px-[17px] py-[13px]"
      >
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="type-body-strong m-0 text-destructive-foreground">Cutoff passed · following run</p>
          <p className="type-body m-0 text-slate-700">
            It is {timeLabel(now.toISOString())}. This order is clearly marked for the following run,{' '}
            {dayLabel(order.deliveryDate)}.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      data-slot="cutoff-countdown"
      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-page px-[13px] py-[11px] whitespace-nowrap"
    >
      <span className="type-body text-slate-700">Cutoff {clockLabel(order.editableUntil)}</span>
      <span className="font-mono text-[12px] font-bold leading-auto text-foreground">{left}</span>
    </div>
  )
}
