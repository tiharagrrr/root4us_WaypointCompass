import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends ComponentProps<'div'> {
  /** Render the child (a router Link, say) as the card. */
  asChild?: boolean
}

/** White surface with the Figma border, radius/lg and Compass/shadow-sm (tables, KPI cards). */
export function Card({ className, asChild = false, ...props }: CardProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp data-slot="card" className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1 px-4 pt-4', className)} {...props} />
}

/** Compass/Card title. */
export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={cn('type-card-title m-0 text-foreground', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('type-body m-0 text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center gap-2 border-t border-border px-4 py-3', className)} {...props} />
}
