import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './icon'

// Figma: "Dialog / Invite user" in A2 (185:9338). A 482 px card on a 40 % black scrim, with a
// header (title, description, close), a body and a footer of right-aligned actions.
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** Hide the × in the header (when the footer has the only way out). */
  hideClose?: boolean
}

export function DialogContent({ className, children, hideClose = false, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-[116px] z-50 flex max-h-[calc(100vh-140px)] w-[482px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-5 top-4 flex h-8 w-7 cursor-pointer items-center justify-center rounded-md text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Icon name="close" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export interface DialogHeaderProps {
  title: ReactNode
  description?: ReactNode
  className?: string
}

/** Title (18 bold) and description (13 muted) over a bottom border. */
export function DialogHeader({ title, description, className }: DialogHeaderProps) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-1 border-b border-border pb-[17px] pl-5 pr-14 pt-4', className)}>
      <DialogPrimitive.Title className="type-title m-0 text-foreground">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="type-body m-0 text-muted-foreground">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
      )}
    </div>
  )
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn('flex flex-col gap-4 overflow-y-auto p-5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex items-center justify-end gap-2 border-t border-border px-5 pb-3.5 pt-[15px]', className)} {...props} />
}
