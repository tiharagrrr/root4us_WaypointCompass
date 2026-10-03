import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Textarea / What happened at the outlet?" in D5 Exception (185:20307), and the reason
// boxes on 19b and 20. Same border and focus ring as Input, sized in rows rather than height.
export type TextareaProps = ComponentProps<'textarea'>

export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(
        'type-body-small w-full min-w-0 resize-none rounded-md border border-input bg-background px-[13px] py-[11px] text-foreground outline-none transition-colors placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive-foreground aria-invalid:ring-status-danger-border',
        className,
      )}
      {...props}
    />
  )
}
