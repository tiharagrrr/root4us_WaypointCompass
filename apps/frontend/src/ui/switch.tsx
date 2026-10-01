import { Switch as SwitchPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

// Figma: the A6 settings toggles (185:10322): 40 × 22 slate-900 track, 16 px white thumb. The off
// state is not drawn in Figma; it uses slate-300.
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full bg-slate-300 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-slate-900',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-[3px] rounded-full bg-background transition-transform data-[state=checked]:translate-x-[21px]" />
    </SwitchPrimitive.Root>
  )
}
