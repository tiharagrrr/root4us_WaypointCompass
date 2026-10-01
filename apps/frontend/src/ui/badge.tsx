import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Badge · LATE RISK" and friends in 19 and 19a. Filled, toned, bold mono capitals.
const badgeVariants = cva(
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-[9px] py-1 font-mono text-[10.5px] font-bold leading-[13px] tracking-[0.42px] uppercase',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-background text-status-neutral-fg',
        muted: 'border-border bg-secondary text-status-neutral-fg',
        info: 'border-status-info-border bg-accent text-primary',
        success: 'border-status-success-border bg-status-success-bg text-status-success-fg',
        warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
        danger: 'border-status-danger-border bg-status-danger-bg text-destructive-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone
}

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span data-slot="badge" data-tone={tone ?? 'neutral'} className={cn(badgeVariants({ tone }), className)} {...props} />
}

/** Figma: "Count badge" on the notifications button (185:8824). */
export function CountBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="count-badge"
      className={cn('inline-flex min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-white', className)}
      {...props}
    />
  )
}
