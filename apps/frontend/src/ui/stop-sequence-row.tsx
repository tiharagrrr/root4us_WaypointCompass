import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { DeliveryWindow, type WindowTone } from './delivery-window'
import { Icon } from './icon'

// Figma: the stop list in 10 View and edit vehicle (488:9736) and 11 (269:2996), and the
// re-sequencing list in 19b (464:2353). Sequence, outlet and order, planned arrival over the
// window, the load, then whatever the screen may do with the stop.
export interface StopSequenceRowProps {
  /** 1-based position in the trip; the frames pad it to two digits. */
  seq: number
  /** Outlet name, e.g. "Kadawatha". */
  name: string
  /** Order code under the name, e.g. "WF-0210". */
  code?: string
  /** Planned arrival, "12:10". */
  arrival?: string
  window?: { open: string; close: string; tone?: WindowTone }
  /** The load at this stop, already formatted ("1,020 kg"). */
  load?: string
  /** Remove, move, or nothing at all: whatever the resource's _links allow. */
  actions?: ReactNode
  /** Shows the drag handle used while re-sequencing (19b). */
  draggable?: boolean
  className?: string
}

export function StopSequenceRow({ seq, name, code, arrival, window, load, actions, draggable = false, className }: StopSequenceRowProps) {
  return (
    <div
      data-slot="stop-sequence-row"
      className={cn('flex items-center gap-3 border-b border-border px-1 py-2.5 last:border-b-0', className)}
    >
      {draggable ? <Icon name="drag" size={18} className="cursor-grab text-slate-400" /> : null}
      <span className="type-metadata w-6 shrink-0 text-muted-foreground">{String(seq).padStart(2, '0')}</span>

      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="type-body-strong truncate text-foreground">{name}</span>
        {code ? <span className="type-mono-small truncate text-muted-foreground">{code}</span> : null}
      </div>

      {arrival || window ? (
        <div className="flex shrink-0 flex-col items-start gap-px">
          {arrival ? <span className="type-data-bold text-foreground">{arrival}</span> : null}
          {window ? <DeliveryWindow open={window.open} close={window.close} tone={window.tone ?? 'muted'} /> : null}
        </div>
      ) : null}

      {load ? <span className="type-data w-20 shrink-0 text-right text-foreground">{load}</span> : null}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}
