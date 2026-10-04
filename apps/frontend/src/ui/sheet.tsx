import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './icon'

// Figma: the dock and driver sheets — L3m Flag an item (254:1605) and D9 Dock and access
// (185:20487). Same scrim as the dialog; the panel slides in from an edge instead of sitting in
// the middle, because a thumb reaches the bottom of a phone and not its centre.
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** bottom on a phone (the default), right on a tablet or desktop. */
  side?: 'bottom' | 'right'
  hideClose?: boolean
}

const SIDES = {
  bottom: 'inset-x-0 bottom-0 max-h-[calc(100svh-56px)] w-full rounded-t-lg border-x-0 border-b-0',
  right: 'inset-y-0 right-0 h-svh w-[420px] max-w-[calc(100vw-48px)] rounded-l-lg border-y-0 border-r-0',
} as const

export function SheetContent({ className, children, side = 'bottom', hideClose = false, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn('fixed z-50 flex flex-col overflow-hidden border border-border bg-background shadow-md outline-none', SIDES[side], className)}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-4 top-3.5 flex size-[var(--compass-size-touch-target)] cursor-pointer items-center justify-center rounded-md text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Icon name="close" size={20} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export interface SheetHeaderProps {
  title: ReactNode
  description?: ReactNode
  className?: string
}

export function SheetHeader({ title, description, className }: SheetHeaderProps) {
  return (
    <div data-slot="sheet-header" className={cn('flex flex-col gap-1 border-b border-border px-4 pb-4 pr-14 pt-4', className)}>
      <DialogPrimitive.Title className="type-title m-0 text-foreground">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="type-body m-0 text-muted-foreground">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
      )}
    </div>
  )
}

export function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-body" className={cn('flex min-h-0 flex-col gap-4 overflow-y-auto p-4', className)} {...props} />
}

/** Full-width stacked actions: a thumb hits a wide target, not a right-aligned pair. */
export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-footer" className={cn('flex flex-col gap-2 border-t border-border px-4 pb-4 pt-3', className)} {...props} />
}
