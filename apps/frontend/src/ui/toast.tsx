import { Toast as ToastPrimitive } from 'radix-ui'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './icon'
import { toastStore, type ToastTone } from './toast-store'

// No toast frame in the admin Figma; this follows the Card and Dialog tokens. Call toast() from
// './toast-store'.
const toneClass: Record<ToastTone, string> = {
  neutral: 'border-border',
  success: 'border-status-success-border',
  danger: 'border-status-danger-border',
}

const titleClass: Record<ToastTone, string> = {
  neutral: 'text-foreground',
  success: 'text-status-success-fg',
  danger: 'text-destructive-foreground',
}

/** Mount once near the root. */
export function Toaster({ duration = 5000 }: { duration?: number }) {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)
  return (
    <ToastPrimitive.Provider duration={duration} swipeDirection="right">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          data-slot="toast"
          data-tone={t.tone}
          onOpenChange={(open) => {
            if (!open) toastStore.dismiss(t.id)
          }}
          className={cn('relative flex w-[360px] items-start gap-3 rounded-lg border bg-background p-4 pr-10 shadow-md', toneClass[t.tone])}
        >
          <div className="flex flex-col gap-1">
            <ToastPrimitive.Title className={cn('type-body-strong', titleClass[t.tone])}>{t.title}</ToastPrimitive.Title>
            {t.description ? <ToastPrimitive.Description className="type-body text-muted-foreground">{t.description}</ToastPrimitive.Description> : null}
          </div>
          <ToastPrimitive.Close aria-label="Dismiss" className="absolute right-3 top-3 flex size-6 cursor-pointer items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
            <Icon name="close" size={14} />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-6 right-6 z-[60] m-0 flex list-none flex-col gap-2 p-0 outline-none" />
    </ToastPrimitive.Provider>
  )
}
