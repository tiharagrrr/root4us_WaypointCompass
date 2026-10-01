import { formatColombo, type Instant } from '@/lib/format-colombo'
import { cn } from '@/lib/cn'

export interface DemoTimeBadgeProps {
  /** The server's time now (GET /clock `now`, or useServerClock().now). */
  serverTime: Instant
  /** The demo clock is moved away from real time: show it in the warning tone. */
  shifted: boolean
  className?: string
}

/**
 * "Demo time Thu 15:55" in the shell header. No Figma frame draws it; it uses the chip tokens,
 * neutral when the clock runs at real time and warning when it is shifted.
 */
export function DemoTimeBadge({ serverTime, shifted, className }: DemoTimeBadgeProps) {
  return (
    <span
      data-slot="demo-time-badge"
      data-shifted={shifted}
      title={shifted ? 'The demo clock is shifted from real time (Asia/Colombo)' : 'Server time (Asia/Colombo)'}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 whitespace-nowrap',
        shifted ? 'border-status-warning-border bg-status-warning-bg text-status-warning-fg' : 'border-border bg-background text-slate-700',
        className,
      )}
    >
      <span className="type-label uppercase">Demo time</span>
      <span className="type-data">{formatColombo(serverTime, 'EEE HH:mm')}</span>
    </span>
  )
}
