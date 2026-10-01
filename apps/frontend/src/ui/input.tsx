import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Input / Tharushi Madushani" in A2 (185:9349) and "Search / Search users" in A1 (185:8809).
const base =
  'type-body w-full min-w-0 rounded-md border border-input bg-background px-[13px] text-foreground outline-none transition-colors placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive-foreground aria-invalid:ring-status-danger-border'

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  /** default 36 px (forms), sm 32 px (toolbars). */
  size?: 'default' | 'sm'
  /** An icon or prefix inside the field, before the text (the search glass in A1). */
  leading?: ReactNode
}

export function Input({ className, size = 'default', leading, ...props }: InputProps) {
  const height = size === 'sm' ? 'h-8' : 'h-9'
  if (leading === undefined) {
    return <input data-slot="input" className={cn(base, height, className)} {...props} />
  }
  return (
    <div data-slot="input-group" className={cn('relative flex items-center', className)}>
      <span className="pointer-events-none absolute left-[13px] flex items-center text-slate-500">{leading}</span>
      <input data-slot="input" className={cn(base, height, 'pl-[37px]')} {...props} />
    </div>
  )
}
