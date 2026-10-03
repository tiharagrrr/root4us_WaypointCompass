// Figma: 05 Plan · empty · 265:2134, the day strip (290:2783) and the stepper (265:2188) that 05
// to 09 share.
import { addDays } from '@waypoint/shared'
import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { Icon } from '@/ui/icon'
import { dayLabel, dayStatus } from './plan-copy'

export interface DayStripProps {
  date: string
  tomorrow: string
  now: Date
  /** The open day's own status chip: NOT STARTED, DRAFT, PUBLISHED. */
  status: string
}

/** "Plan for" and five days from tomorrow, plus a date picker for any other day. */
export function DayStrip({ date, tomorrow, now, status }: DayStripProps) {
  const navigate = useNavigate()
  const picker = useRef<HTMLInputElement>(null)
  const days = Array.from({ length: 5 }, (_, i) => addDays(tomorrow, i))
  if (!days.includes(date)) days.push(date)
  days.sort()
  const go = (day: string) => void navigate(`/dispatch/plan/${day}`)

  return (
    <div data-slot="day-strip" className="flex items-center gap-2 overflow-x-auto border-t border-border px-6 py-2.5">
      <span className="type-label shrink-0 uppercase text-muted-foreground">Plan for</span>
      {days.map((day) => {
        const active = day === date
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => go(day)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              active ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-slate-50',
            )}
          >
            <span className="type-body-medium text-foreground">
              {dayLabel(day)}
              {day === tomorrow ? ' · Tomorrow' : ''}
            </span>
            <span className="type-mono-small uppercase text-muted-foreground">{active ? status : dayStatus(day, now)}</span>
          </button>
        )
      })}
      <label className="relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 hover:bg-slate-50">
        <Icon name="forecast" size={16} className="text-slate-700" />
        <span className="type-body-medium text-foreground">Pick a date</span>
        <input
          ref={picker}
          type="date"
          aria-label="Pick a date"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={date}
          onChange={(event) => event.target.value && go(event.target.value)}
        />
      </label>
    </div>
  )
}

const STEPS = ['Build plan', 'Confirm trips', 'Unplanned orders', 'Publish'] as const

/** The four planning steps (05 to 18); 05 to 11 are step 1. */
export function PlanStepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol data-slot="plan-stepper" className="m-0 flex list-none items-center gap-3 border-b border-slate-200 px-6 pb-[13px] pt-3">
      {STEPS.map((label, i) => {
        const current = i + 1 === step
        return (
          <li key={label} className="flex items-center gap-3">
            {i > 0 ? <span aria-hidden="true" className="h-0.5 w-14 border-t-2 border-dashed border-slate-300" /> : null}
            <span className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
              <span
                aria-hidden="true"
                className={cn(
                  'flex items-center justify-center rounded-full',
                  current ? 'size-[22px] border-2 border-blue-700' : 'size-[18px] border border-input',
                )}
              >
                <span className={cn('rounded-full', current ? 'size-2 bg-primary' : 'size-1.5 bg-slate-400')} />
              </span>
              <span className={cn('font-sans text-[13px] leading-auto', current ? 'font-bold text-foreground' : 'font-medium text-muted-foreground')}>
                {label}
              </span>
            </span>
          </li>
        )
      })}
      <li aria-hidden="true" className="flex-1" />
      <li className="type-metadata uppercase text-muted-foreground">
        Step {step} of {STEPS.length}
      </li>
    </ol>
  )
}
