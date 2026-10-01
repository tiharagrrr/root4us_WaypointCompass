import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Segmented control" in A1 (185:8829, role filter with counts) and A2 (185:9379).
export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  /** Shown after the label in Compass/Data, muted (A1's "Drivers 14"). */
  count?: number
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedOption<V>[]
  value: V
  onValueChange: (value: V) => void
  'aria-label': string
  className?: string
}

export function SegmentedControl<V extends string>({ options, value, onValueChange, className, ...aria }: SegmentedControlProps<V>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-control"
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next)
        if (option) onValueChange(option.value)
      }}
      orientation="horizontal"
      className={cn('inline-flex h-[31px] w-fit items-stretch gap-1 rounded-md bg-secondary p-[3px]', className)}
      {...aria}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="type-field-label flex cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-1 whitespace-nowrap text-slate-600 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-segment"
        >
          {option.label}
          {option.count !== undefined ? <span className="font-mono text-[11px] font-medium text-muted-foreground">{option.count}</span> : null}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
