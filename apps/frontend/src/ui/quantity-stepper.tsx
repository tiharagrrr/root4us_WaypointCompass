import { cn } from '@/lib/cn'

// Figma: "Quantity stepper" in M1a (233:1109). Minus, the count, plus, inside one bordered group.
export interface QuantityStepperProps {
  value: number
  onValueChange: (next: number) => void
  /** Packs, so the floor is 1; stepping below it removes the line instead (M1a). */
  min?: number
  max?: number
  /** What the stepper counts, for the buttons' labels: "Add one pack of Sugar 1 kg". */
  label: string
  disabled?: boolean
  className?: string
}

export function QuantityStepper({ value, onValueChange, min = 1, max = 999, label, disabled, className }: QuantityStepperProps) {
  const step = (by: number) => {
    const next = value + by
    if (next < min || next > max) return
    onValueChange(next)
  }
  const button = 'flex h-11 w-[45px] cursor-pointer items-center justify-center font-sans text-[18px] leading-auto text-slate-700 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div data-slot="quantity-stepper" className={cn('flex items-center overflow-hidden rounded-md border border-input p-px', className)}>
      <button type="button" aria-label={`One less ${label}`} disabled={disabled || value <= min} className={cn(button, 'border-r border-slate-200')} onClick={() => step(-1)}>
        −
      </button>
      <output aria-label={`${label}, ${value} packs`} className="type-data-bold w-[44.5px] text-center text-[15px] text-foreground">
        {value}
      </output>
      <button type="button" aria-label={`One more ${label}`} disabled={disabled || value >= max} className={cn(button, 'border-l border-slate-200')} onClick={() => step(1)}>
        +
      </button>
    </div>
  )
}
