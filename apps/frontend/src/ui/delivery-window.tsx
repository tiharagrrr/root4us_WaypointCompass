import { cn } from '@/lib/cn'

// Figma: the window line in D3 Next stop (185:20107), the stop rows in 09 and 19a. An outlet's
// delivery window as the frames write it: 07:00–08:00, in mono, with an en dash and no spaces.
export type WindowTone = 'default' | 'muted' | 'at-risk' | 'late'

export interface DeliveryWindowProps {
  /** "07:00" — already in Asia/Colombo (formatColombo). */
  open: string
  close: string
  tone?: WindowTone
  /** Bold, for the value column of a definition row. */
  strong?: boolean
  className?: string
}

const TONES: Record<WindowTone, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  'at-risk': 'text-status-at-risk-fg',
  late: 'text-status-danger-fg',
}

export function DeliveryWindow({ open, close, tone = 'default', strong = false, className }: DeliveryWindowProps) {
  return (
    <span data-slot="delivery-window" data-tone={tone} className={cn(strong ? 'type-data-bold' : 'type-data', TONES[tone], className)}>
      {open}–{close}
    </span>
  )
}
