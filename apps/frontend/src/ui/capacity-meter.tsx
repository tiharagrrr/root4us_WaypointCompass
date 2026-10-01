import { cn } from '@/lib/cn'

// Figma: 09 Plan · vehicles (268:2245) and 11 Over capacity (269:2996). A label, the used-of-limit
// figure with its percentage, and a hairline bar. Over the limit the figure and the bar turn red:
// the engine decides what is allowed, this only shows it (packages/engine, rule CAP_WEIGHT).
export interface CapacityMeterProps {
  /** "WEIGHT", "VOLUME" — Compass/Label capitals. */
  label: string
  value: number
  limit: number
  /** "kg", "m³". */
  unit: string
  /** Decimals in the figures: 0 for kilograms, 1 for cubic metres. */
  fractionDigits?: number
  /** Hide the figure and keep the bar, for the trip cards in the plan rail. */
  barOnly?: boolean
  className?: string
}

const format = (n: number, fractionDigits: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })

export function CapacityMeter({ label, value, limit, unit, fractionDigits = 0, barOnly = false, className }: CapacityMeterProps) {
  const percent = limit > 0 ? Math.round((value / limit) * 100) : 0
  const over = value > limit

  return (
    <div data-slot="capacity-meter" data-over={over || undefined} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-label uppercase text-muted-foreground">{label}</span>
        {barOnly ? null : (
          <span className={cn('type-data', over ? 'text-status-danger-fg' : 'text-foreground')}>
            {format(value, fractionDigits)} / {format(limit, fractionDigits)} {unit} · {percent}%
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuetext={`${format(value, fractionDigits)} of ${format(limit, fractionDigits)} ${unit}, ${percent}%`}
        className="h-[3px] w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-200', over ? 'bg-status-danger-icon' : 'bg-primary')}
          style={{ width: `${String(Math.min(percent, 100))}%` }}
        />
      </div>
    </div>
  )
}
