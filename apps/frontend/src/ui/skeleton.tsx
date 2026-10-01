import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/** Loading placeholder. Size it to the content it stands in for, so the layout does not jump. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
