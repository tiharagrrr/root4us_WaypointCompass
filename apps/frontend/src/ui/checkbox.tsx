import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './icon'

// Figma: the tick list in D4 Record stop (185:20191). 24 px box, slate-900 when ticked with a white
// check, an empty bordered square when not. The row around it is the touch target, not the box.
export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-input bg-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900 data-[state=checked]:text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Icon name="check" size={19} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
