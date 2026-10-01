import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Chip / ACTIVE" in A1 (185:8866) and the stop chips in 19a. White fill, toned border and
// text, Compass/Label in capitals. Pass the API status; the chip does not translate it.
const chipVariants = cva(
  'type-label inline-flex h-[22px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-sm border bg-background px-2 py-[3px] uppercase leading-4',
  {
    variants: {
      tone: {
        neutral: 'border-status-neutral-border text-status-neutral-fg',
        muted: 'border-border text-slate-600',
        info: 'border-status-info-border text-primary',
        success: 'border-status-success-border text-status-success-fg',
        warning: 'border-status-warning-border text-status-warning-fg',
        danger: 'border-status-danger-border text-destructive-foreground',
        'at-risk': 'border-status-at-risk-border text-status-at-risk-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type StatusTone = NonNullable<VariantProps<typeof chipVariants>['tone']>

export interface StatusChipProps extends ComponentProps<'span'> {
  tone?: StatusTone
}

export function StatusChip({ tone, className, ...props }: StatusChipProps) {
  return <span data-slot="status-chip" data-tone={tone ?? 'neutral'} className={cn(chipVariants({ tone }), className)} {...props} />
}
