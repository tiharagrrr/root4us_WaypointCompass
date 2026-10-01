import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Options / Role" in A2 (185:9357). Two columns of 42 px cards; the chosen one is accent
// blue with a thick ring.
export interface RadioCardOption<V extends string> {
  value: V
  label: ReactNode
}

export interface RadioCardsProps<V extends string> {
  options: readonly RadioCardOption<V>[]
  value: V | undefined
  onValueChange: (value: V) => void
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}

export function RadioCards<V extends string>({ options, value, onValueChange, className, ...aria }: RadioCardsProps<V>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-cards"
      value={value ?? ''}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next)
        if (option) onValueChange(option.value)
      }}
      className={cn('grid grid-cols-2 gap-2', className)}
      {...aria}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="group type-field-label flex h-[42px] cursor-pointer items-center gap-2.5 rounded-md border border-slate-300 bg-background px-[13px] text-left text-foreground outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:border-blue-700 data-[state=checked]:bg-accent data-[state=checked]:text-primary"
        >
          <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-input group-data-[state=checked]:border-[5px] group-data-[state=checked]:border-blue-700" />
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
